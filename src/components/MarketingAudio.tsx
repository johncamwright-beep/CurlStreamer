function AudioScene({ commentary = false }: { commentary?: boolean }) {
  return (
    <svg viewBox="0 0 520 240" aria-hidden="true" className="audio-scene">
      {commentary ? (
        <>
          <rect x="24" y="24" width="472" height="154" rx="14" fill="#dcece9" />
          <path d="M40 148h440M40 58h440" stroke="#aac8c5" strokeWidth="2" />
          <ellipse cx="260" cy="105" rx="54" ry="35" fill="#afd2d9" />
          <ellipse cx="260" cy="105" rx="35" ry="23" fill="#fff" />
          <ellipse cx="260" cy="105" rx="17" ry="11" fill="#d28875" />
          {[155, 365].map((x, i) => (
            <g key={x}>
              <path
                d={`M${x - 45} 196v-28a45 45 0 0 1 90 0v28`}
                fill="#174754"
              />
              <circle cx={x} cy="112" r="24" fill="#e9b899" />
              <path
                d={`M${x - 30} 115v-10a30 30 0 0 1 60 0v10`}
                fill="none"
                stroke="#102b36"
                strokeWidth="6"
              />
              <rect
                x={x - 34}
                y="102"
                width="9"
                height="23"
                rx="4"
                fill="#102b36"
              />
              <rect
                x={x + 25}
                y="102"
                width="9"
                height="23"
                rx="4"
                fill="#102b36"
              />
              <rect
                x={x - 9}
                y="156"
                width="18"
                height="25"
                rx="5"
                fill="#68dce3"
              />
              <text
                x={x}
                y="174"
                textAnchor="middle"
                fill="#102b36"
                fontSize="16"
                fontWeight="700"
              >
                {i + 1}
              </text>
            </g>
          ))}
          <rect x="65" y="193" width="390" height="12" rx="6" fill="#a97956" />
          <path d="M90 205v25m340-25v25" stroke="#174754" strokeWidth="8" />
        </>
      ) : (
        <>
          <rect
            x="24"
            y="24"
            width="472"
            height="192"
            rx="22"
            fill="#e7f2f1"
            stroke="#bdd6d5"
            strokeWidth="2"
          />
          <path
            d="M260 25v190M100 25v190M420 25v190"
            stroke="#b8d1d6"
            strokeWidth="2"
          />
          {[100, 420].map((x) => (
            <g key={x}>
              <circle cx={x} cy="120" r="56" fill="#aeced8" />
              <circle cx={x} cy="120" r="37" fill="#fff" />
              <circle cx={x} cy="120" r="18" fill="#d28875" />
            </g>
          ))}
          {[
            [155, 65],
            [245, 155],
            [315, 65],
            [390, 155],
          ].map(([x, y], i) => (
            <g key={x}>
              <circle
                cx={x}
                cy={y}
                r="12"
                fill="#e9b899"
                stroke="#174754"
                strokeWidth="3"
              />
              <rect
                x={x - 16}
                y={y + 14}
                width="32"
                height="34"
                rx="12"
                fill="#174754"
              />
              <rect
                x={x - 8}
                y={y + 20}
                width="16"
                height="22"
                rx="4"
                fill="#68dce3"
              />
              <text
                x={x}
                y={y + 36}
                textAnchor="middle"
                fill="#102b36"
                fontSize="14"
                fontWeight="700"
              >
                {i + 1}
              </text>
              <path
                d={`M${x + 21} ${y + 18}q12 10 0 20m6-26q19 16 0 32`}
                fill="none"
                stroke="#358894"
                strokeWidth="2"
              />
            </g>
          ))}
        </>
      )}
    </svg>
  );
}

export function MarketingAudio() {
  return (
    <section className="section audio-section" id="audio">
      <div className="wrap">
        <div className="intro">
          <div className="eyebrow">Two ways to tell the story</div>
          <h2>
            Hear the calls.
            <br />
            Or call the game.
          </h2>
          <p>
            Bring viewers closer with the DJI Mic 3 system. Set up with up to
            four wireless microphones on the ice, or turn your setup into a
            commentary station for the stream.
          </p>
        </div>
        <div className="audio-options">
          <article className="audio-option">
            <div className="audio-option-copy">
              <span className="eyebrow">01 / On-ice audio</span>
              <h3>Four players. Four microphones.</h3>
              <p>
                Clip a DJI Mic 3 transmitter to each player. Bring the strategy,
                sweeping calls and reactions into the broadcast as the game
                unfolds.
              </p>
            </div>
            <figure>
              <AudioScene />
              <figcaption>
                Example: four players wearing wireless microphones.
              </figcaption>
            </figure>
            <p className="audio-kit">
              <strong>The audio kit</strong>Up to 4 DJI Mic 3 transmitters + a
              DJI Mic 3 receiver.
            </p>
          </article>
          <article className="audio-option">
            <div className="audio-option-copy">
              <span className="eyebrow">02 / Live commentary</span>
              <h3>Your own commentary desk.</h3>
              <p>
                Use the microphones with one or two commentators at the rink.
                Add play-by-play, explain the shot and tell the stories behind
                the score.
              </p>
            </div>
            <figure>
              <AudioScene commentary />
              <figcaption>
                Example: two commentators overlooking the ice.
              </figcaption>
            </figure>
            <p className="audio-kit">
              <strong>The audio kit</strong>Commentator microphones + receiver,
              with headphones to check the mix.
            </p>
          </article>
        </div>
        <div className="audio-route" aria-label="Audio connection setup">
          <div className="audio-route-intro">
            <strong>Either setup. One broadcast.</strong>
            <span>Wireless microphones → receiver, then:</span>
          </div>
          <ol>
            <li>
              <span className="audio-route-icon" aria-hidden="true">
                ▥
              </span>
              <div>
                <strong>DJI Mic 3 receiver</strong>
                <span>Connect to the PC by USB</span>
              </div>
            </li>
            <li>
              <span className="audio-route-icon" aria-hidden="true">
                ▱
              </span>
              <div>
                <strong>Windows Studio</strong>
                <span>Mix audio with cameras + score</span>
              </div>
            </li>
            <li>
              <span className="audio-route-icon" aria-hidden="true">
                ▶
              </span>
              <div>
                <strong>YouTube broadcast</strong>
                <span>Your pictures and sound, together</span>
              </div>
            </li>
          </ol>
        </div>
        <div className="audio-details">
          <p>
            <strong>Stay in control.</strong> Adjust microphone levels and mute
            audio between ends in Studio. Camera microphones can add rink
            ambience; use headphones to check the balance.
          </p>
          <p>
            <strong>Keep the camera network.</strong> Your phones and Windows PC
            still connect through the travel router. The microphone receiver
            connects directly to the PC by USB.
          </p>
        </div>
        <p className="audio-footnote">
          Audio equipment is optional and sold separately. For four players,
          choose a setup with four transmitters.{" "}
          <a
            href="https://www.dji.com/mic-3/faq"
            target="_blank"
            rel="noreferrer"
          >
            DJI Mic 3 system details ↗
          </a>
        </p>
      </div>
    </section>
  );
}
