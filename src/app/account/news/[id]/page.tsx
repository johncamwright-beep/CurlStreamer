import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { AppNavigation } from "@/components/AppNavigation";
import { NewsPostEditor } from "@/components/NewsPostEditor";
export default async function NewsEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.union([z.literal("new"), z.uuid()]).safeParse(id).success) notFound();
  if (!(await teamSettingsContext(true))) redirect("/account");
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-5 md:py-10">
      <div className="mb-5">
        <AppNavigation signedIn />
      </div>
      <NewsPostEditor key={id} postId={id} />
    </main>
  );
}
