"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { cancelVisit } from "./actions";

export function CancelButton({ id }: { id: string }) {
  return (
    <form
      action={cancelVisit}
      onSubmit={(e) => { if (!confirm("Batalkan pasien dari antrian?")) e.preventDefault(); }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="">
        <i className="ti ti-x" />
      </SubmitButton>
    </form>
  );
}
