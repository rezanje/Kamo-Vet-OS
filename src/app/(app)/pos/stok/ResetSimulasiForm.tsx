import Link from "next/link";
import { RESET_SIMULASI_UNAVAILABLE_MESSAGE } from "@/lib/simulasi-reset";

// Retain the existing entry point, but deliberately offer no executable reset.
export function ResetSimulasiForm({ role }: { role: string | null | undefined }) {
  if (role !== "OWNER") return null;

  return (
    <section className="crm-sec" aria-labelledby="reset-maintenance-title" style={{ borderColor: "#fecaca", background: "#fffafa" }}>
      <h2 id="reset-maintenance-title" style={{ fontSize: 14, fontWeight: 800, color: "#991b1b", margin: "0 0 8px" }}>
        Reset simulasi total — seluruh cabang
      </h2>
      <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.7 }}>
        <p style={{ margin: "0 0 10px" }}>
          Reset lama bersifat destruktif: menghapus data di seluruh cabang dan seluruh gudang,
          termasuk master barang/SKU, stok, transaksi terkait dan jurnal terkait.
          Filter gudang di atas tidak membatasi reset. Tindakan ini tidak bisa dibatalkan tanpa pemulihan cadangan.
        </p>
        <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{RESET_SIMULASI_UNAVAILABLE_MESSAGE}</p>
        <p style={{ margin: "0 0 8px" }}>Halaman ini hanya panduan dan tidak mengirim perintah reset. Untuk kebutuhan pembersihan data:</p>
        <ol style={{ paddingLeft: 20, margin: "0 0 10px" }}>
          <li>Catat tujuan dan cakupan data, lalu tinjau daftar SKU, kartu stok dan riwayat penyesuaian secara baca saja.</li>
          <li>Minta pengelola sistem memeriksa izin, dependensi data dan backup, serta membuktikan restore di lingkungan terisolasi.</li>
          <li>Dapatkan persetujuan Owner atas cakupan, rencana pemulihan dan jadwal maintenance sebelum tindakan manual oleh pengelola sistem.</li>
        </ol>
        <p style={{ margin: "0 0 12px" }}>
          Jika percobaan sebelumnya terputus atau hasilnya belum diketahui, minta pemeriksaan log/audit secara baca saja terlebih dahulu.
        </p>
        <nav aria-label="Tinjau data sebelum maintenance" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Link href="/pos/sku" className="btn-def">Lihat master SKU</Link>
          <Link href="/pos/kartu-stok" className="btn-def">Lihat kartu stok</Link>
          <Link href="/pos/penyesuaian" className="btn-def">Lihat riwayat penyesuaian</Link>
        </nav>
      </div>
    </section>
  );
}
