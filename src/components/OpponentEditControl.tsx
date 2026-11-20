"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OpponentDetailsDialog } from "./OpponentDetailsDialog";

export function OpponentEditControl({
  opponentId,
  opponentName,
  seasonId,
  seasonName,
}: {
  opponentId: string;
  opponentName: string;
  seasonId: string;
  seasonName: string;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className="btn-secondary min-h-11"
        onClick={() => {
          setOpen(true);
          setSaved("");
        }}
      >
        Edit opponent
      </button>
      {saved && <p role="status">{saved}</p>}
      {open && (
        <OpponentDetailsDialog
          mode="edit"
          opponent={{ id: opponentId, display_name: opponentName }}
          seasonId={seasonId}
          seasonName={seasonName}
          onCancel={() => setOpen(false)}
          onSaved={(value) => {
            setOpen(false);
            setSaved(value.display_name + " · " + seasonName + " saved.");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
