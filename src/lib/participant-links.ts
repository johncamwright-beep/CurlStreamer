import "server-only";

type ParticipantLinkEnvironment = {
  APP_BASE_URL?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
};

function isProduction(environment: ParticipantLinkEnvironment) {
  if (environment.VERCEL_ENV) return environment.VERCEL_ENV === "production";
  return environment.NODE_ENV === "production";
}

function appOrigin(environment: ParticipantLinkEnvironment) {
  const configured = environment.APP_BASE_URL;
  if (!configured)
    throw new Error("Missing environment variable: APP_BASE_URL");

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Invalid environment variable: APP_BASE_URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    configured !== url.origin
  ) {
    throw new Error("Invalid environment variable: APP_BASE_URL");
  }
  return url.origin;
}

/** Builds links that may be opened on participant devices. */
export function participantUrl(
  request: Request,
  path: string,
  environment: ParticipantLinkEnvironment = process.env,
) {
  const origin = isProduction(environment)
    ? appOrigin(environment)
    : new URL(request.url).origin;
  return new URL(path, `${origin}/`).toString();
}
