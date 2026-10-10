export function checkPublicSite(
  fetcher?: (url: string, options: RequestInit) => Promise<Response>,
): Promise<{
  checkedAt: string;
  ok: boolean;
  results: { name: string; ok: boolean }[];
}>;
