import { redirect } from "next/navigation";
export default async function YouTubeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  redirect(
    "/account?section=youtube" +
      (result ? "&result=" + encodeURIComponent(result) : ""),
  );
}
