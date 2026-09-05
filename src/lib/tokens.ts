import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./types";

export type AccessPurpose = "invitation" | "participant" | "organizer";

function signingSecret() {
  const configured = process.env.ROLE_TOKEN_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (!configured || configured.length < 32)
  )
    throw new Error(
      "ROLE_TOKEN_SECRET must contain at least 32 characters in production",
    );
  return new TextEncoder().encode(
    configured || "curlcast-mock-development-secret-only",
  );
}

async function issueAccessToken(
  gameId: string,
  purpose: AccessPurpose,
  expiresIn: string,
  role?: Role,
  deviceId?: string,
  assignmentGeneration?: number,
  tokenId = crypto.randomUUID(),
) {
  return new SignJWT({
    gameId,
    purpose,
    role,
    deviceId,
    assignmentGeneration,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(tokenId)
    .setExpirationTime(expiresIn)
    .sign(signingSecret());
}

/** Shareable invitations are brief and exchange once a device claims a role. */
export function issueRoleToken(
  gameId: string,
  role: Role,
  invitationId?: string,
  assignmentGeneration?: number,
) {
  return issueAccessToken(
    gameId,
    "invitation",
    "30m",
    role,
    undefined,
    assignmentGeneration,
    invitationId,
  );
}

export function issueChooserToken(gameId: string) {
  return issueAccessToken(gameId, "invitation", "30m");
}

/** Game sessions cover setup, play, and reconnection without becoming permanent. */
export function issueParticipantToken(
  gameId: string,
  role: Role,
  deviceId: string,
  assignmentGeneration?: number,
) {
  return issueAccessToken(
    gameId,
    "participant",
    "6h",
    role,
    deviceId,
    assignmentGeneration,
  );
}

export function issueOrganizerToken(gameId: string) {
  return issueAccessToken(gameId, "organizer", "6h");
}

export async function readAccessToken(token: string) {
  const { payload } = await jwtVerify(token, signingSecret());
  return payload as {
    gameId: string;
    purpose: AccessPurpose;
    role?: Role;
    deviceId?: string;
    assignmentGeneration?: number;
    jti?: string;
    iat?: number;
    exp?: number;
  };
}
