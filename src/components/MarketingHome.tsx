"use client";

import { useState } from "react";
import Link from "next/link";
import { PilotWaitlistForm } from "./PilotWaitlistForm";
import "./MarketingHome.css";

const features = {
  Games: [
    "The season, in one place",
    "Upcoming games, results and YouTube links, with event filters to find the right match.",
  ],
  "News & photos": [
    "Tell the story behind the score",
    "Share team updates with images and links, event photos, your roster and accomplishments.",
  ],
  Sponsors: [
    "Give your supporters a place to shine",
    "Show sponsor images, names and business links on your team page, with sponsor placement in your broadcast too.",
  ],
  "Social media": [
    "Connect your team’s social presence",
    "Add links to your social profiles. Direct Facebook and Instagram publishing is planned and is not part of the current pilot.",
  ],
};

export function MarketingHome() {
  const [feature, setFeature] = useState<keyof typeof features>("Games");
  return (
    <div className="marketing-page">
      <div className="notice">
        <strong>COMING SOON</strong> We’re getting CurlStreamer ready for more
        teams. Join the pilot waitlist.
      </div>
      <header>
        <div className="wrap">
          <nav aria-label="Main navigation">
            <Link className="brand" href="/" aria-label="CurlStreamer home">
              <img
                src="/branding/curlstreamer-logo.png"
                alt="CurlStreamer"
                width="190"
                height="48"
              />
            </Link>
            <a className="nav-section" href="#how">
              How it works
            </a>
            <a className="nav-section" href="#equipment">
              Equipment
            </a>
            <a className="nav-section" href="#teams">
              Team pages
            </a>
            <a href="/login">Log in</a>
            <a className="cta" href="#pilot">
              Join the pilot
            </a>
          </nav>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="wrap split">
            <div>
              <div className="eyebrow">
                Your team. Your game. Your audience.
              </div>
              <h1>
                Bring the rink
                <br />
                to everyone.
              </h1>
              <p>
                Turn your phones into curling cameras. Bring the score, team
                audio and sponsors together in one YouTube broadcast.
              </p>
              <div className="actions">
                <a className="cta" href="#pilot">
                  Join the pilot waitlist →
                </a>
                <a className="cta secondary" href="#how">
                  See how it works
                </a>
              </div>
              <small>
                Coming soon. Register your interest—no payment or download
                required.
              </small>
            </div>
            <div className="demo">
              <div className="demo-top">
                <span>CURLSTREAMER BROADCAST</span>
                <span className="live">EXAMPLE LAYOUT</span>
              </div>
              <div className="program">
                <div className="ice">
                  <span>CAMERA 1</span>
                </div>
                <div className="ice">
                  <span>CAMERA 2</span>
                </div>
                <div className="program-side">
                  <b>
                    Club Classic
                    <br />
                    Game 1
                  </b>
                  <p>September 17 · 8:00 AM EDT</p>
                  <div className="score">
                    <span>Home team</span>
                    <b>4</b>
                  </div>
                  <div className="score">
                    <span>Away team</span>
                    <b>3</b>
                  </div>
                  <div className="sponsor">
                    YOUR TEAM IS SPONSORED BY
                    <br />
                    <strong>Your sponsors</strong>
                  </div>
                  <img src="/branding/curlstreamer-logo.png" alt="" />
                </div>
              </div>
              <p className="caption">
                Illustrated broadcast layout with two camera views, score and
                sponsors.
              </p>
            </div>
          </div>
        </section>
        <div className="wrap strip">
          <span>Two camera views</span>
          <span>Live scoring</span>
          <span>Team &amp; camera audio</span>
          <span>Sponsor visibility</span>
          <span>Your own team page</span>
        </div>
        <section className="section" id="how">
          <div className="wrap">
            <div className="intro">
              <div className="eyebrow">From setup to first stone</div>
              <h2>
                A game-day workflow
                <br />
                built around curling.
              </h2>
              <p>
                Plan the season in your browser. Open Studio at the rink. Give
                family, friends and supporters one place to follow along.
              </p>
            </div>
            <div className="grid3">
              <article className="tile">
                <span className="number">01 / PLAN</span>
                <h3>Set up the game</h3>
                <p>
                  Choose the event, opponent, date and local time. Add a game
                  number if you want one. Reserve a YouTube watch link for a
                  scheduled stream.
                </p>
              </article>
              <article className="tile">
                <span className="number">02 / CONNECT</span>
                <h3>Scan. Frame. Check.</h3>
                <p>
                  Connect your phones and Windows computer to your travel
                  router. Open Studio, scan the camera invitations, then check
                  pictures and audio.
                </p>
              </article>
              <article className="tile">
                <span className="number">03 / BROADCAST</span>
                <h3>Share every end</h3>
                <p>
                  Start the YouTube broadcast when ready. Score from Studio or
                  invite a remote scorer. Finish with results and a replay link
                  for your team page.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section className="section tint" id="equipment">
          <div className="wrap">
            <div className="intro">
              <div className="eyebrow">What you’ll need</div>
              <h2>
                Phones on the ice.
                <br />
                Your own network at the rink.
              </h2>
              <p>
                The CurlStreamer setup requires a <strong>travel router</strong>{" "}
                to connect the camera phones and Windows computer on the same
                local network. You also need internet access to send the stream
                to YouTube.
              </p>
            </div>
            <div
              className="flow"
              aria-label="Phones and Windows Studio connect through a travel router. Studio sends the finished broadcast to YouTube using an internet connection."
            >
              <div className="node">
                <div className="device" aria-hidden="true">
                  <div className="phone" />
                  <div className="phone" />
                </div>
                <b>Camera phones</b>
                <small>Mounts + charging power</small>
              </div>
              <div className="arrow" aria-hidden="true">
                →
              </div>
              <div className="node">
                <div className="device network" aria-hidden="true">
                  <div className="router" />
                </div>
                <b>Travel router + Windows Studio</b>
                <small>Your local camera network</small>
              </div>
              <div className="arrow" aria-hidden="true">
                →
              </div>
              <div className="node">
                <div className="device network" aria-hidden="true">
                  ▶
                </div>
                <b>YouTube viewers</b>
                <small>Internet upload required</small>
              </div>
            </div>
            <div className="gear">
              <article>
                <h3>Travel router</h3>
                <p>
                  Required. Creates the local network for your camera phones and
                  computer. A router does not supply internet by itself; arrange
                  a suitable internet connection at the rink.
                </p>
              </article>
              <article>
                <h3>Windows computer</h3>
                <p>
                  Runs Studio, receives the cameras and sends the finished
                  broadcast. Pilot setup guidance will cover supported
                  specifications.
                </p>
              </article>
              <article>
                <h3>One or two phones</h3>
                <p>
                  Browser camera connections, stable mounts and charging power
                  for the game. Two phones give you both camera views.
                </p>
              </article>
              <article>
                <h3>Optional wireless audio</h3>
                <p>
                  A compatible USB receiver and player microphones. Camera
                  microphones can provide ambience. Use headphones to check the
                  mix.
                </p>
              </article>
            </div>
            <small>
              Hardware is not included. You’ll also need a YouTube channel
              enabled for live streaming. A separate phone or tablet can handle
              remote scoring.
            </small>
          </div>
        </section>
        <section className="section dark">
          <div className="wrap split">
            <div>
              <div className="eyebrow" style={{ color: "#75d9df" }}>
                One game. One control room.
              </div>
              <h2>
                Everything that belongs
                <br />
                in the broadcast.
              </h2>
              <p>
                Two camera views, end-by-end scoring, microphone levels and
                sponsor placement—managed together.
              </p>
              <p>
                Give your scorer a dedicated invitation so they can update the
                scoreboard while the operator looks after the stream.
              </p>
            </div>
            <div
              className="studio-schematic"
              aria-label="Illustrative Studio controls"
            >
              <div className="eyebrow" style={{ color: "#75d9df" }}>
                Studio · illustrated controls
              </div>
              <div className="studio-row">
                <strong>Match score · End 4</strong>
                <span>Home 4</span>
                <span>Away 3</span>
              </div>
              <div className="studio-row">
                <strong>Cameras</strong>
                <span>Camera 1</span>
                <span>Camera 2</span>
              </div>
              <div className="studio-row">
                <strong>Sponsors</strong>
                <span>Overlay / side panel</span>
              </div>
              <div className="studio-row">
                <strong>Audio</strong>
                <span>Volume + mute controls</span>
              </div>
              <div className="audio-sample" />
              <div className="studio-row">
                <strong>YouTube</strong>
                <span>Preview → Go live</span>
              </div>
              <p className="caption">
                Example controls. Pilot software is still being refined.
              </p>
            </div>
          </div>
        </section>
        <section className="section" id="teams">
          <div className="wrap split">
            <div>
              <div className="eyebrow">Beyond the broadcast</div>
              <h2>
                A home for
                <br />
                your whole season.
              </h2>
              <p>
                Your team gets a public address, with your name, colours and
                identity. Choose what supporters can see.
              </p>
              <div className="tabs" aria-label="Team page features">
                {(Object.keys(features) as (keyof typeof features)[]).map(
                  (name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={name === feature}
                      onClick={() => setFeature(name)}
                    >
                      {name}
                    </button>
                  ),
                )}
              </div>
              <div className="feature" aria-live="polite">
                <h3>{features[feature][0]}</h3>
                <p>{features[feature][1]}</p>
                <span
                  className={`pill ${feature === "Social media" ? "planned" : ""}`}
                >
                  {feature === "Social media"
                    ? "Profile links in pilot · publishing planned"
                    : "Part of the pilot product"}
                </span>
              </div>
            </div>
            <div className="team-preview">
              <div className="team-head">
                <div className="sample-badge" aria-hidden="true">
                  Y
                </div>
                <div>
                  <b>Your Team</b>
                  <p>Your team. Your season.</p>
                  <small>yourteam.curlstreamer.app · example address</small>
                </div>
              </div>
              <div className="team-content">
                <div>
                  <div className="mini">
                    <b>Your Team Games</b>
                    <div className="game-row">
                      <span>Club Classic · Game 1</span>
                      <span>Watch ↗</span>
                    </div>
                    <div className="game-row">
                      <span>Club Classic · Game 2</span>
                      <span>Upcoming</span>
                    </div>
                  </div>
                  <div className="mini">
                    <b>Your Team News</b>
                    <p>Our season starts here ＋</p>
                    <p>Thank you to our supporters ＋</p>
                  </div>
                  <div className="mini">
                    <b>Proudly sponsored by</b>
                    <p>Sponsor images · names · website links</p>
                  </div>
                </div>
                <aside>
                  <div className="mini">
                    <b>About the team</b>
                    <p>Team bio and photo</p>
                    <hr />
                    <b>Players</b>
                    <p>
                      Fourth · Third / Skip
                      <br />
                      Second · Lead
                    </p>
                    <hr />
                    <b>Accomplishments</b>
                    <p>Tournament results</p>
                  </div>
                </aside>
              </div>
              <div style={{ padding: "0 20px 16px" }}>
                <small>Fictional team page for illustration.</small>
              </div>
            </div>
          </div>
        </section>
        <section className="section tint" id="pilot">
          <div className="wrap waitlist-grid">
            <div>
              <div className="eyebrow">Coming soon · pilot waitlist</div>
              <h2>
                Help shape the next
                <br />
                season of streaming.
              </h2>
              <p>
                We’re refining CurlStreamer with early teams before a wider
                release. Leave your email if you’d like to hear when pilot
                invitations are available.
              </p>
              <p>
                <strong>No payment. No automatic subscription.</strong>
                <br />
                Joining the waitlist doesn’t start a trial or guarantee a pilot
                place. We’ll share availability and setup details before you
                decide to take part.
              </p>
              <p>
                Public downloads, pricing and trial details will follow as the
                product becomes ready.
              </p>
            </div>
            <PilotWaitlistForm />
          </div>
        </section>
        <section className="section">
          <div className="wrap faq">
            <div className="eyebrow">Before you start</div>
            <h2>A few good questions.</h2>
            <details>
              <summary>Is CurlStreamer available now?</summary>
              <p>
                CurlStreamer is in an early pilot. You can register interest
                now; public downloads, paid plans and any trial offer are not
                available yet.
              </p>
            </details>
            <details>
              <summary>Do I need a travel router?</summary>
              <p>
                Yes. The pilot setup uses a travel router to put the phones and
                Windows computer on the same local network. You also need an
                internet connection for YouTube. We’ll provide setup guidance
                with pilot invitations.
              </p>
            </details>
            <details>
              <summary>Can I manage the team away from the rink?</summary>
              <p>
                Use the website for scheduling and team information. The Windows
                computer runs Studio for the broadcast at the rink.
              </p>
            </details>
            <details>
              <summary>Do viewers need a CurlStreamer account?</summary>
              <p>
                Published team pages are public. Broadcasts open on YouTube and
                follow the video’s visibility and viewing settings.
              </p>
            </details>
            <details>
              <summary>Can someone else keep score?</summary>
              <p>
                Yes. Share the game’s remote scorer invitation so another phone
                or tablet can update the scoreboard.
              </p>
            </details>
            <details>
              <summary>Will it post to Facebook and Instagram?</summary>
              <p>
                Social profile links are included in the pilot. Direct
                publishing is planned and depends on completing the platform
                integrations and approvals.
              </p>
            </details>
          </div>
        </section>
        <section className="closing">
          <div className="eyebrow">Let them be part of it</div>
          <h2>
            They can’t all be at the rink.
            <br />
            They can still follow your team.
          </h2>
          <p>CurlStreamer is coming soon. Be part of what comes next.</p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <a className="cta" href="#pilot">
              Join the pilot waitlist →
            </a>
            <a className="cta secondary" href="#equipment">
              Check the equipment
            </a>
          </div>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <span>CurlStreamer · A home for your game.</span>
          <div className="site-footer-links">
            <a href="#pilot-privacy">Waitlist privacy</a>
            <a href="/login">Existing pilot member? Log in</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
