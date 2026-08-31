"use client";

import { markBookingNoShow } from "./actions";

export function NoShowButton({ id }: { id: string }) {
  return (
    <form action={markBookingNoShow}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 11 }}
        onClick={(event) => { if (!window.confirm("Tandai booking ini tidak hadir?")) event.preventDefault(); }}>
        <i className="ti ti-user-off" /> No-show
      </button>
    </form>
  );
}
