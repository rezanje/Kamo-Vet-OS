"use client";

import { useState } from "react";
import { createReferral } from "./actions";

type Referral = { id: string; direction: string; facility: string; reason: string; notes: string | null; referred_at: string };

export function ReferralPanel({ visitId, referrals }: { visitId: string; referrals: Referral[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-hd" style={{ justifyContent: "space-between" }}>
        <span><i className="ti ti-transfer" style={{ color: "var(--posb)" }} /> Referral</span>
        <button type="button" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5 }} onClick={() => setOpen((value) => !value)}>
          <i className="ti ti-plus" /> Catat referral
        </button>
      </div>
      {open && (
        <form action={createReferral} style={{ display: "grid", gap: 7, marginBottom: 10 }}>
          <input type="hidden" name="visit_id" value={visitId} />
          <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 7 }}>
            <select className="fi" name="direction" defaultValue="keluar"><option value="masuk">Masuk</option><option value="keluar">Keluar</option></select>
            <input className="fi" name="facility" placeholder="Fasilitas / dokter rujukan" required />
          </div>
          <input className="fi" name="reason" placeholder="Alasan referral" required />
          <textarea className="fi" name="notes" rows={2} placeholder="Catatan tambahan (opsional)" />
          <button type="submit" className="btn-acc" style={{ justifySelf: "start", background: "var(--posb)" }}><i className="ti ti-device-floppy" /> Simpan referral</button>
        </form>
      )}
      {referrals.length === 0 ? <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada referral.</div> : (
        <div style={{ display: "grid", gap: 6 }}>
          {referrals.map((referral) => <div key={referral.id} style={{ borderTop: ".5px solid var(--bd)", paddingTop: 6, fontSize: 10.5 }}>
            <span className={`bge ${referral.direction === "masuk" ? "g" : "b"}`}>{referral.direction}</span> <b>{referral.facility}</b> · {referral.reason}
            {referral.notes && <div style={{ color: "var(--tm)", marginTop: 2 }}>{referral.notes}</div>}
          </div>)}
        </div>
      )}
    </div>
  );
}
