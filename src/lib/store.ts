import "server-only";
import { publishGameChange } from "./providers/game-change-notice";
import { selectStoreProvider } from "./providers/store-selection";

const provider = selectStoreProvider();
const store =
  provider === "supabase"
    ? await import("./providers/supabase-store")
    : await import("./providers/local-store");

export const createGame = store.createGame;
export const getGame = store.getGame;
export async function prepareRoleInvitation(
  ...args: Parameters<typeof store.prepareRoleInvitation>
) {
  const action = store.prepareRoleInvitation as (
    ...input: Parameters<typeof store.prepareRoleInvitation>
  ) => ReturnType<typeof store.prepareRoleInvitation>;
  const result = await action(...args);
  await publishGameChange(args[0]);
  return result;
}
export async function prepareCameraReconnect(
  ...args: Parameters<typeof store.prepareCameraReconnect>
) {
  const action = store.prepareCameraReconnect as (
    ...input: Parameters<typeof store.prepareCameraReconnect>
  ) => ReturnType<typeof store.prepareCameraReconnect>;
  const result = await action(...args);
  await publishGameChange(args[0]);
  return result;
}
export async function claimRole(...args: Parameters<typeof store.claimRole>) {
  const action = store.claimRole as (
    ...input: Parameters<typeof store.claimRole>
  ) => ReturnType<typeof store.claimRole>;
  const result = await action(...args);
  await publishGameChange(args[0]);
  return result;
}
export async function releaseRole(
  ...args: Parameters<typeof store.releaseRole>
) {
  const action = store.releaseRole as (
    ...input: Parameters<typeof store.releaseRole>
  ) => ReturnType<typeof store.releaseRole>;
  const result = await action(...args);
  await publishGameChange(args[0]);
  return result;
}
export const listCameraIdentityGenerations =
  store.listCameraIdentityGenerations;
export async function updateGame(...args: Parameters<typeof store.updateGame>) {
  const action = store.updateGame as (
    ...input: Parameters<typeof store.updateGame>
  ) => ReturnType<typeof store.updateGame>;
  const result = await action(...args);
  if (args[1].type !== "camera-health") await publishGameChange(args[0]);
  return result;
}
