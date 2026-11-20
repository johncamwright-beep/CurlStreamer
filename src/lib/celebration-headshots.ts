export type CelebrationRosterPlayer = {
  id: string;
  name: string;
  position: string;
  kind?: "roster" | "coach";
};
export type CelebrationHeadshot = {
  id: string;
  rosterPlayerId: string;
  playerName: string;
  position: string;
  imageUrl: string;
};
export type CelebrationHeadshotLibrary = {
  players: CelebrationRosterPlayer[];
  headshots: CelebrationHeadshot[];
  canEdit: boolean;
};
