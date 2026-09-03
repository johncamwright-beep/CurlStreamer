"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hasOrganizerAccess } from "@/lib/access-session";

export function GameSetupNavigation({ id }: { id: string }) {
  const [organizer, setOrganizer] = useState<boolean>();
  useEffect(() => setOrganizer(hasOrganizerAccess(localStorage, id)), [id]);
  if (organizer === undefined) return <div className="min-h-11" />;
  return (
    <Link
      className="btn-secondary inline-flex min-h-11 items-center"
      href={organizer ? `/games/${id}` : `/join/${id}`}
    >
      {organizer ? "← Back to Game Setup" : "← Exit Scoring"}
    </Link>
  );
}
