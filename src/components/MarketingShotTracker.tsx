export function MarketingShotTracker() {
  return (
    <section
      className="section dark tracker-section"
      id="shot-tracker"
      aria-labelledby="tracker-title"
    >
      <div className="wrap">
        <div className="split">
          <div>
            <div className="eyebrow">Optional CurlStreamer add-on</div>
            <h2 id="tracker-title">
              Shot Tracker.
              <br />
              See more than the score.
            </h2>
            <p>
              Give your coach a place to record each shot, spot patterns and
              plan the next practice. Use your phone, tablet or computer
              alongside the same events, games and players you already manage in
              CurlStreamer.
            </p>
            <ul className="tracker-benefits">
              <li>
                <strong>Track the details.</strong> Record shot types, grades,
                turns and reasons for misses as the game unfolds.
              </li>
              <li>
                <strong>Find the patterns.</strong> Compare shooting percentages
                by player, game, event or season, with shot breakdowns and miss
                analysis.
              </li>
              <li>
                <strong>Keep a private review list.</strong> Flag shots and add
                coaching notes without publishing them on your team page.
              </li>
            </ul>
            <div className="tracker-price">
              <strong>$39 CAD</strong>
              <span>per assigned coach licence / season</span>
            </div>
            <p className="tracker-terms">
              Added to the $89 CAD CurlStreamer season pass. Access ends August
              31; purchase again for the next season. No automatic renewal.
            </p>
            <a className="cta" href="#pilot">
              Interested in Shot Tracker? Join the pilot →
            </a>
            <p className="tracker-availability">
              Coming soon with CurlStreamer. Joining the waitlist does not start
              a paid plan.
            </p>
          </div>
          <figure className="tracker-preview">
            <figcaption>
              <strong>
                SHOT <span>TRACKER</span>
              </strong>
              <span>ILLUSTRATIVE DATA</span>
            </figcaption>
            <div className="tracker-context">
              <span>Club Classic</span>
              <span>All games · Whole team</span>
            </div>
            <div className="tracker-sample-score">
              <span>Shooting percentage</span>
              <strong>
                75<small>%</small>
              </strong>
              <span>48 graded shots</span>
            </div>
            <div
              className="tracker-bars"
              aria-label="Example shooting percentages: draws 80 percent, hits 70 percent"
            >
              <div>
                <span>Draws</span>
                <strong>80%</strong>
                <div className="tracker-bar">
                  <span style={{ width: "80%" }} />
                </div>
              </div>
              <div>
                <span>Hits</span>
                <strong>70%</strong>
                <div className="tracker-bar">
                  <span style={{ width: "70%" }} />
                </div>
              </div>
            </div>
            <div className="tracker-note">
              <span>FLAGGED FOR REVIEW · END 4</span>
              <strong>Draw · Second · Stone 1</strong>
              <p>
                Light weight. Review the release and sweeping call together.
              </p>
              <small>Private coaching note</small>
            </div>
            <p className="caption">
              Example view with fictional shot data. Record shots during play,
              then return to your notes for review.
            </p>
          </figure>
        </div>
        <ol
          className="tracker-steps"
          aria-label="How Shot Tracker connects to your team"
        >
          <li>
            <span>01</span>
            <div>
              <strong>Use your existing games</strong>
              <p>
                Your season, events and game line scores stay connected to
                CurlStreamer.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Assign coach access</strong>
              <p>
                The team owner assigns each purchased licence to themselves or
                an invited team member.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Review privately</strong>
              <p>
                The assigned coach opens Shot Tracker from their menu. Coaching
                notes stay off the public page.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
