import "server-only";
import { selectStoreProvider } from "./providers/store-selection";

const provider = selectStoreProvider();
const store =
  provider === "supabase"
    ? await import("./providers/supabase-store")
    : await import("./providers/local-store");

export const createGame = store.createGame;
export const getGame = store.getGame;
export const claimRole = store.claimRole;
export const releaseRole = store.releaseRole;
export const updateGame = store.updateGame;
