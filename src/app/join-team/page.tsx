import { JoinTeam } from "./JoinTeam";

export default async function JoinTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <JoinTeam token={token} />;
}
