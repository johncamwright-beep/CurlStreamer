"use client";

import { useState } from "react";

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

export function MarketingFeatureTabs() {
  const [feature, setFeature] = useState<keyof typeof features>("Games");
  return (
    <>
      <div className="tabs" aria-label="Team page features">
        {(Object.keys(features) as (keyof typeof features)[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === feature}
            onClick={() => setFeature(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="feature" aria-live="polite">
        <h3>{features[feature][0]}</h3>
        <p>{features[feature][1]}</p>
        <span className={`pill ${feature === "Social media" ? "planned" : ""}`}>
          {feature === "Social media"
            ? "Profile links in pilot · publishing planned"
            : "Part of the pilot product"}
        </span>
      </div>
    </>
  );
}
