"use client";
import { useState, useTransition } from "react";
import { ubahStatusPelanggan, type StatusPelanggan } from "./actions";

const fmtWaktu = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * Status aktif pelanggan di panel detail. Pelanggan nonaktif (mis. akun penampung "CS pusat")
 * tidak bisa dipilih untuk transaksi baru di kasir, klinik, dan faktur; riwayatnya tetap utuh.
 * Tombolnya hanya untuk OWNER/ADMIN — database ikut menolak peran lain.
 */
export function StatusPelangganPanel({ id, nama, status, isAdmin, onBerubah }: {
  id: string;
  nama: string;
  status: StatusPelanggan;
  isAdmin: boolean;
  onBerubah: (status: StatusPelanggan) => void;
}) {
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [pesan, setPesan] = useState("");
  const [menyimpan, startSimpan] = useTransition();

  const simpan = (aktif: boolean) => {
    setPesan("");
    startSimpan(async () => {
      const hasil = await ubahStatusPelanggan(id, aktif, alasan);
      if (!hasil.ok) { setPesan(hasil.error); return; }
      setKonfirmasi(false); setAlasan("");
      onBerubah(hasil.status);
    });
  };

  if (!status.is_active) {
    return (
      <div role="status" style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#991b1b", fontSize: 10.5 }}>
        <div style={{ fontWeight: 700 }}><i className="ti ti-user-off" /> Pelanggan nonaktif</div>
        <div style={{ marginTop: 2 }}>
          Sejak {fmtWaktu(status.deactivated_at)}{status.penonaktif ? ` oleh ${status.penonaktif}` : ""}.
          {status.deactivation_reason ? ` Alasan: ${status.deactivation_reason}.` : ""}
        </div>
        <div style={{ marginTop: 2, color: "#7f1d1d" }}>Tidak bisa dipilih untuk transaksi baru. Riwayat, poin, dan piutangnya tetap tersimpan.</div>
        {isAdmin && (
          <button type="button" className="btn-def" disabled={menyimpan} onClick={() => simpan(true)} style={{ marginTop: 6, fontSize: 10, padding: "4px 10px" }}>
            {menyimpan ? "Menyimpan…" : "Aktifkan lagi"}
          </button>
        )}
        {pesan && <div role="alert" style={{ marginTop: 4 }}>{pesan}</div>}
      </div>
    );
  }

  if (!isAdmin) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {!konfirmasi ? (
        <button type="button" className="btn-def" onClick={() => setKonfirmasi(true)} style={{ fontSize: 10, padding: "4px 10px", color: "#b91c1c" }}>
          <i className="ti ti-user-off" /> Nonaktifkan pelanggan
        </button>
      ) : (
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "#fff7ed", border: ".5px solid #fdba74", fontSize: 10.5 }}>
          <div style={{ fontWeight: 600 }}>Nonaktifkan {nama}?</div>
          <div style={{ color: "var(--tm)", marginTop: 2 }}>
            Pelanggan ini tidak akan muncul lagi di pencarian kasir, POS, klinik, dan faktur, dan transaksi baru atas namanya ditolak.
            Riwayat, poin, dan piutangnya tetap tersimpan. Bisa diaktifkan lagi kapan saja.
          </div>
          <input className="fi" value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500}
            placeholder="Alasan (opsional), mis. akun penampung CS pusat" aria-label="Alasan menonaktifkan"
            style={{ marginTop: 6, fontSize: 11, padding: "4px 8px" }} />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button type="button" className="btn-acc" disabled={menyimpan} onClick={() => simpan(false)} style={{ fontSize: 10, padding: "4px 10px", background: "#b91c1c", borderColor: "#b91c1c" }}>
              {menyimpan ? "Menyimpan…" : "Ya, nonaktifkan"}
            </button>
            <button type="button" className="btn-def" disabled={menyimpan} onClick={() => { setKonfirmasi(false); setPesan(""); }} style={{ fontSize: 10, padding: "4px 10px" }}>Batal</button>
          </div>
          {pesan && <div role="alert" style={{ marginTop: 4, color: "#b91c1c" }}>{pesan}</div>}
        </div>
      )}
    </div>
  );
}
