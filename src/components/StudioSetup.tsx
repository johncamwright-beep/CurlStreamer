"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useGame } from "./GameSync";
import { hasOrganizerAccess } from "@/lib/access-session";
import { GameReadScreen } from "./GameReadScreen";
import { M3Operator } from "./M3Operator";
import { GameInvitations } from "./GameInvitations";
import { StudioDeviceCards } from "./StudioDeviceCards";
import "./game-entry.css";

export function StudioSetup({
  id,
  directCameras,
  pairing,
}: {
  id: string;
  directCameras: boolean;
  pairing: boolean;
}) {
  const { game, completion, accountRole, error, refreshContext, refresh } =
    useGame(id, undefined, undefined, true);
  const [organizer, setOrganizer] = useState(false);
  const [gameUrl, setGameUrl] = useState("");
  const [message, setMessage] = useState("");
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    // Presentation only; native and server authorization do not trust this hint.
    setDesktop(navigator.userAgent.includes("CurlStreamerStudio/0.3"));
    setOrganizer(hasOrganizerAccess(localStorage, id));
    setGameUrl(new URL(`/games/${id}`, location.origin).href);
  }, [id]);
  if (completion)
    return (
      <main className="game-control-page studio-setup">
        <div className="game-control-inner">
          <h1 className="text-3xl font-bold">Windows Studio</h1>
          <p role="status" className="my-4">
            This game has ended.
          </p>
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`/games/${id}`}
          >
            Return to game summary
          </Link>
        </div>
      </main>
    );
  if (error || !game)
    return (
      <GameReadScreen
        label="Windows Studio"
        error={error}
        retry={refreshContext}
        light
      />
    );
  const allowed = organizer || ["owner", "team_admin"].includes(accountRole);
  if (desktop)
    return (
      <main className="studio-connect-page">
        <Link href={"/score/" + id}>← Back to Game day</Link>
        <header>
          <p className="game-entry-eyebrow">Device setup</p>
          <h1>Connect your devices</h1>
          <p>
            {game.config.homeName} vs {game.config.awayName}
          </p>
          <p>
            Keep camera phones on the same network as this PC. Choose a role
            below and scan its QR code with that device.
          </p>
        </header>
        {!allowed ? (
          <p role="status">
            Sign in as this game’s administrator to invite devices.
          </p>
        ) : !directCameras ? (
          <p role="status">
            Camera setup is not enabled on this deployment yet.
          </p>
        ) : (
          <StudioDeviceCards
            id={id}
            claims={game.claims}
            onChanged={refresh}
            enabled
          />
        )}
        <section className="studio-connect-note">
          <h2 className="font-semibold">Recording on this PC</h2>
          <p>
            Use Start recording at the bottom of Studio. Your score and sponsor
            graphics are included automatically. Keep camera pages open during
            the game.
          </p>
        </section>
      </main>
    );
  return (
    <main className="game-control-page studio-setup">
      <div className="game-control-inner">
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`/games/${id}`}
        >
          Back to game
        </Link>
        <header className="game-control-heading">
          <p className="game-entry-eyebrow">Recording PC</p>
          <h1>Windows Studio</h1>
          <p>
            {game.config.homeName} vs {game.config.awayName}
          </p>
        </header>
        {!allowed ? (
          <p role="status">
            Sign in as this game’s administrator or use organizer access to set
            up Studio.
          </p>
        ) : (
          <>
            {desktop ? (
              <section className="game-control-card">
                <h2>Recording on this PC</h2>
                <p>
                  Use Start recording at the bottom of Studio. It connects this
                  game automatically. Stop &amp; save recording finalizes the
                  file.
                </p>
                <p>
                  You can score here or invite a phone or tablet as Scorekeeper.
                  Camera devices should use the same local network as this PC.
                </p>
              </section>
            ) : (
              <section
                className="game-control-card"
                aria-labelledby="open-studio-heading"
              >
                <h2 id="open-studio-heading">Requires Windows Studio</h2>
                <p>
                  Streaming starts only in CurlStreamer Studio on the Windows
                  recording PC. Install the pilot Windows installer supplied by
                  your CurlStreamer contact, then open Studio with this game.
                  There is no public installer download yet.
                </p>
                <div className="game-entry-actions">
                  {gameUrl.startsWith("https://") && (
                    <a
                      className="btn"
                      href={`curlstreamer://open?game=${encodeURIComponent(gameUrl)}`}
                    >
                      Open Windows Studio
                    </a>
                  )}
                  <button
                    className="btn-secondary"
                    disabled={!gameUrl}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(gameUrl);
                        setMessage(
                          "Game link copied. Paste it into Windows Studio.",
                        );
                      } catch {
                        setMessage(
                          "Copy the game link from the field below and paste it into Windows Studio.",
                        );
                      }
                    }}
                  >
                    Copy game link
                  </button>
                </div>
                <label className="mt-4 block" htmlFor="studio-game-link">
                  Game link
                </label>
                <input
                  id="studio-game-link"
                  readOnly
                  value={gameUrl}
                  className="min-h-11 w-full rounded border border-slate-400 bg-white p-3 text-slate-900"
                />
                <p className="mt-3">
                  If nothing opens, launch CurlStreamer Studio from Windows and
                  paste this link. The preview installer is currently supplied
                  separately; there is no public download yet.
                </p>
                <p role="status" className="mt-3">
                  {message}
                </p>
                <p>
                  Keep the Studio window open while recording. Closing a browser
                  tab does not stop the recording.
                </p>
              </section>
            )}
            <section className="game-control-card">
              <h2>
                {desktop
                  ? "Cameras & remote scoring"
                  : "Connect the travel router, cameras and recording PC"}
              </h2>
              {directCameras ? (
                <>
                  {!desktop && (
                    <p>
                      Connect the recording PC and camera phones to the same
                      travel router before opening Studio. Keep client isolation
                      off, connect the PC by Ethernet when possible, and give it
                      internet access for YouTube. In Studio’s local controls,
                      choose Check this PC, then create camera invitations
                      below.
                    </p>
                  )}
                  <details className="mt-4">
                    <summary className="min-h-11 cursor-pointer py-3">
                      {desktop
                        ? "Camera and Scorekeeper QR invitations"
                        : "Camera invitations"}
                    </summary>
                    <GameInvitations
                      id={id}
                      enabled
                      claims={game.claims}
                      connectedDevices={
                        <p>Manage assigned devices from the game page.</p>
                      }
                    />
                  </details>
                  {!desktop && (
                    <details className="mt-4">
                      <summary className="min-h-11 cursor-pointer py-3">
                        Prepare recording connection
                      </summary>
                      <M3Operator id={id} studio />
                    </details>
                  )}
                </>
              ) : (
                <p role="status">
                  Direct-camera recording is not enabled on this deployment yet.
                  You can open Studio and check the installation; camera setup
                  will be available here when this deployment is enabled.
                </p>
              )}
            </section>
            {!desktop && (
              <section className="game-control-card">
                <h2>3. Pair and stream when ready</h2>
                {pairing ? (
                  <>
                    <p>
                      Pair the desktop using the challenge shown in Studio.
                      Confirm your local recording before preparing the YouTube
                      broadcast.
                    </p>
                    <div className="game-entry-actions">
                      <Link
                        className="btn-secondary"
                        href={`/studio-m4/${id}/pairing`}
                      >
                        Pair desktop
                      </Link>
                      <Link className="btn-secondary" href={`/studio-m4/${id}`}>
                        YouTube preparation
                      </Link>
                    </div>
                  </>
                ) : (
                  <p role="status">
                    YouTube pairing and streaming are not enabled on this
                    deployment yet.
                  </p>
                )}
                <p className="mt-3">
                  Stopping streaming leaves recording running. Use Finish and
                  close Studio to finalize the recording before shutting down
                  the PC.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
