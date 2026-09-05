import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function credentialKey(value = process.env.YOUTUBE_CREDENTIAL_ENCRYPTION_KEY) {
  if (!value) throw new Error("youtube_credentials_unavailable");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("youtube_credentials_unavailable");
  return key;
}

function additionalData(organizationId: string) {
  return Buffer.from(`curlstreamer:youtube:${organizationId}`, "utf8");
}

export function encryptYouTubeRefreshToken(
  refreshToken: string,
  organizationId: string,
  keyValue?: string,
) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(keyValue), iv);
  cipher.setAAD(additionalData(organizationId));
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString("base64");
}

export function decryptYouTubeRefreshToken(
  envelope: string,
  organizationId: string,
  keyValue?: string,
) {
  try {
    const value = Buffer.from(envelope, "base64");
    if (value[0] !== VERSION || value.length <= 1 + IV_BYTES + TAG_BYTES)
      throw new Error("invalid envelope");
    const iv = value.subarray(1, 1 + IV_BYTES);
    const tag = value.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = value.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      credentialKey(keyValue),
      iv,
    );
    decipher.setAAD(additionalData(organizationId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("youtube_credentials_unavailable");
  }
}

export function encryptYouTubeOAuthCookie(
  payload: string,
  userId: string,
  keyValue?: string,
) {
  return encryptYouTubeRefreshToken(payload, `oauth:${userId}`, keyValue);
}

export function decryptYouTubeOAuthCookie(
  envelope: string,
  userId: string,
  keyValue?: string,
) {
  return decryptYouTubeRefreshToken(envelope, `oauth:${userId}`, keyValue);
}
