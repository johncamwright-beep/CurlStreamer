/** Bundled team artwork for the pilot; new teams can register their own asset. */
const teamLogos: Record<string, string> = {
  "team benning": "/branding/team-benning.png",
};
export function TeamLogo({
  teamName,
  className = "h-10 w-10",
}: {
  teamName: string;
  className?: string;
}) {
  const src = teamLogos[teamName.trim().replace(/\s+/g, " ").toLowerCase()];
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
