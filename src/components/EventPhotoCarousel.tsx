"use client";
import { useState } from "react";
import type { TeamPageSettings } from "@/lib/team-page-settings";
export function EventPhotoCarousel({
  photos,
}: {
  photos: TeamPageSettings["gallery"];
}) {
  const [index, setIndex] = useState(0);
  if (!photos.length) return null;
  const current = photos[index % photos.length];
  return (
    <section id="event-photos" className="panel mb-5" aria-label="Event photos">
      <h2 className="mb-4 text-xl font-bold">Event photos</h2>
      <figure>
        <img
          src={current.url}
          alt={current.caption || "Team event photo"}
          className="aspect-video w-full rounded-lg object-cover object-center"
        />
        {current.caption && (
          <figcaption className="mt-3 text-center">
            {current.caption}
          </figcaption>
        )}
      </figure>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          className="btn-secondary"
          disabled={photos.length < 2}
          onClick={() => setIndex((index + photos.length - 1) % photos.length)}
        >
          Previous photo
        </button>
        <span className="text-sm" aria-live="polite">
          {(index % photos.length) + 1} / {photos.length}
        </span>
        <button
          className="btn-secondary"
          disabled={photos.length < 2}
          onClick={() => setIndex((index + 1) % photos.length)}
        >
          Next photo
        </button>
      </div>
    </section>
  );
}
