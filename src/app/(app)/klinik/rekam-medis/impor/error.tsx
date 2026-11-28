"use client";

import { BackLink } from "@/components/BackLink";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="crm-sec" style={{ maxWidth: 720 }}>
      <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#991b1b" }}>
        <i className="ti ti-alert-circle" /> Impor rekam medis belum bisa dibuka. Data belum disimpan.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" className="btn-acc" onClick={() => reset()} style={{ background: "var(--posb)" }}>
          <i className="ti ti-refresh" /> Coba buka ulang
        </button>
        <BackLink href="/klinik/antrian" className="btn-def"><i className="ti ti-arrow-left" /> Kembali ke antrian</BackLink>
      </div>
    </div>
  );
}
