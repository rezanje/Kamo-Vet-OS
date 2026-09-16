"use client";

import Link from "next/link";

export default function RekamMedisImportError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="crm-sec" style={{ maxWidth: 720 }}>
      <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
        <i className="ti ti-alert-circle" /> Impor rekam medis belum bisa dibuka.
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: "var(--tm)", lineHeight: 1.6 }}>
        Halaman mengalami gangguan saat memuat. Data belum disimpan. Coba buka ulang, lalu pilih file atau folder lagi.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button type="button" className="btn-acc" onClick={() => reset()} style={{ background: "var(--posb)" }}>
          <i className="ti ti-refresh" /> Coba buka ulang
        </button>
        <Link className="btn-def" href="/klinik/antrian"><i className="ti ti-arrow-left" /> Kembali ke Klinik</Link>
      </div>
    </div>
  );
}
