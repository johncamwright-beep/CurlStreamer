import "server-only";
import { participantUrl } from "./participant-links";

/** Explicit server-owned aliases allow installed Studio versions to survive a domain migration. */
export function studioOrigin(request: Request, environment = process.env) {
  const canonical = new URL(
    participantUrl(request, "/", {
      NODE_ENV: environment.NODE_ENV,
      APP_BASE_URL: environment.APP_BASE_URL,
    }),
  ).origin;
  const aliases = (environment.STUDIO_ADDITIONAL_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const alias of aliases) {
    const parsed = new URL(alias);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== alias ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Invalid Studio origin configuration");
  }
  const origin = request.headers.get("origin");
  return origin && aliases.includes(origin) ? origin : canonical;
}
