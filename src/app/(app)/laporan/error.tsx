"use client";

export default function ReportError({ reset }: { reset: () => void }) {
  return <div className="crm-sec" role="alert">
    <p>Laporan belum dapat dibaca lengkap. Muat ulang atau pilih periode dan cabang yang lebih kecil.</p>
    <button type="button" className="btn-def" onClick={reset}>Muat ulang laporan</button>
  </div>;
}
