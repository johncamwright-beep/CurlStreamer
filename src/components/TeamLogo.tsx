/** Bundled team artwork for the pilot; new teams can register their own asset. */
const teamLogos: Record<string, string> = {
  "team benning": "/branding/team-benning.png",
};
export function teamLogoSource(teamName: string) {
  return teamLogos[teamName.trim().replace(/\s+/g, " ").toLowerCase()] ?? null;
}
export function TeamLogo({
  teamName,
  imageUrl,
  className = "h-10 w-10",
}: {
  teamName: string;
  imageUrl?: string;
  className?: string;
}) {
  const src = imageUrl || teamLogoSource(teamName);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={teamName + " logo"}
      className={className + " shrink-0 object-contain"}
    />
  );
}
