// Komponen gerbang laporan (A1, meeting 12 Nov 2026) — lihat src/lib/report-gate.ts.
import { PARAM_TAMPIL } from "@/lib/report-gate";

/** Taruh di dalam <form> filter laporan: submit "Tampilkan" membawa `tampil=1`. */
export function InputTampil() {
  return <input type="hidden" name={PARAM_TAMPIL} value="1" data-report-gate-input />;
}

/** Pengganti isi laporan sebelum pengguna menekan Tampilkan. Tidak memicu query apa pun. */
export function LaporanBelumDitampilkan({ pesan }: { pesan?: string }) {
  return (
    <div data-report-gate className="crm-sec" role="status" style={{ textAlign: "center", padding: "36px 16px", color: "var(--tm)" }}>
      <i className="ti ti-filter" style={{ fontSize: 26, color: "#2563eb" }} />
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sb)", marginTop: 8 }}>Laporan belum ditampilkan</div>
      <div style={{ fontSize: 11.5, marginTop: 4 }}>
        {pesan ?? "Pilih filter (cabang, rentang tanggal, dan lainnya), lalu klik Tampilkan."}
      </div>
    </div>
  );
}
