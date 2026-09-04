import type { GameState } from "@/lib/types";

export const testGameId = "11111111-1111-4111-8111-111111111111";
export function gameFixture(): GameState {
  return {
    id: testGameId,
    config: {
      eventName: "Club final",
      homeName: "Rocks",
      awayName: "Stones",
      homeColor: "#000000",
      awayColor: "#ffffff",
      scheduledEnds: 8,
      initialHammer: "home",
      youtubeTitle: "Private stream title",
      youtubeVisibility: "private",
    },
    createdAt: 1,
    scoreEvents: [
      {
        id: "score-1",
        at: 1,
        type: "end",
        score: { end: 1, team: "home", points: 2, blank: false },
      },
      {
        id: "score-2",
        at: 2,
        type: "end",
        score: { end: 2, team: "away", points: 3, blank: false },
      },
      { id: "undo-1", at: 3, type: "undo", targetId: "score-2" },
    ],
    layout: "split",
    broadcast: "live",
    status: "active",
    audioMuted: false,
    connections: { "camera-home": true, "camera-away": false, scorer: true },
    cameraHealth: {
      "camera-home": {
        phase: "live",
        updatedAt: 1,
        diagnostic: "private diagnostic",
      },
    },
    cameraFraming: { "camera-home": "contain", "camera-away": "contain" },
    claims: {
      "camera-home": "private-home-device",
      "camera-away": "private-away-device",
      scorer: "private-scorer-device",
    },
    sponsors: [
      {
        id: "private-sponsor-id",
        name: "Community",
        dataUrl: "/sponsors/community.svg",
        enabled: true,
        rotation: 0,
      },
      {
        id: "signed-asset",
        name: "Private library",
        dataUrl:
          "https://storage.invalid/storage/v1/object/sign/private/path?token=credential",
        enabled: true,
        rotation: 0,
      },
      {
        id: "disabled-asset",
        name: "Disabled",
        dataUrl: "/sponsors/rock.svg",
        enabled: false,
        rotation: 0,
      },
    ],
    sponsorMode: {
      active: true,
      style: "overlay",
      intervalSeconds: 4,
      startedAt: 1000,
      rotationOffset: 1,
      paused: true,
      mutedPrevious: false,
      muteDuring: true,
    },
  };
}
