"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { hasScoringAccess } from "@/lib/access-session";

export function BroadcastOperatorNavigation({ id }: { id: string }) {
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => setAuthorized(hasScoringAccess(localStorage, id)), [id]);

  if (!authorized) return null;
  return (
    <Link
      data-testid="back-to-scoring"
      className="broadcast-operator-navigation btn-secondary inline-flex items-center focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      href={`/score/${id}`}
    >
      ← Back to Scoring
    </Link>
  );
}
