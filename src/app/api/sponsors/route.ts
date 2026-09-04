import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  libraryForAccount,
  mutateSponsor,
  uploadSponsor,
} from "@/lib/providers/sponsor-library";

async function user() {
  const { data } = await (await createServerSupabaseClient()).auth.getUser();
  return data.user?.email_confirmed_at ? data.user : null;
}
const failure = (error: unknown) =>
  NextResponse.json(
    {
      error:
        error instanceof ZodError
          ? "Check the sponsor name, alt text, and order."
          : error instanceof Error
            ? error.message
            : "Sponsor library is unavailable.",
    },
    { status: error instanceof ZodError ? 400 : 403 },
  );

export async function GET() {
  const account = await user();
  if (!account)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    return NextResponse.json(await libraryForAccount(account));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const account = await user();
  if (!account)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const form = await request.formData();
    const files = form.getAll("files");
    const names = form.getAll("displayNames").map(String);
    const alts = form.getAll("altTexts").map(String);
    if (!files.length || files.some((file) => !(file instanceof File)))
      throw new Error("Choose at least one sponsor image.");
    await Promise.all(
      files.map((file, index) =>
        uploadSponsor(account, file as File, {
          displayName: names[index],
          altText: alts[index],
        }),
      ),
    );
    return NextResponse.json(await libraryForAccount(account), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  const account = await user();
  if (!account)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new Error("Choose a replacement image.");
      await uploadSponsor(
        account,
        file,
        {
          displayName: String(form.get("displayName") ?? "Sponsor"),
          altText: String(form.get("altText") ?? "Sponsor logo"),
        },
        String(form.get("sponsorId") ?? ""),
      );
    } else await mutateSponsor(account, await request.json());
    return NextResponse.json(await libraryForAccount(account));
  } catch (error) {
    return failure(error);
  }
}
