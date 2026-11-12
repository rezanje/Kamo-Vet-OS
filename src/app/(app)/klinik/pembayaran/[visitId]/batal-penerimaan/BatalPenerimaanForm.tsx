"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ringkasanHasil, type HasilBatal } from "@/lib/batal-penerimaan-pesan";
import { batalkanPenerimaanKlinik, pratinjauTanggalBatalPenerimaan } from "./actions";

/**
 * "Batalkan penerimaan": ringkasan efek (dari pratinjau database), tanggal efektif (Owner), alasan wajib, persetujuan eksplisit, lalu satu kali kirim.
 * Tanggal efektif: bawaan hari ini; Owner (atau peran berizin) boleh memilih mundur sampai tanggal penerimaan asli. Database memutuskan sah-tidaknya
 * tanggal (periode terkunci, batas, hak); layar hanya menampilkan alasannya lebih awal.
 */
export function BatalPenerimaanForm({ visitId, invoiceId, invoiceNo, ringkasan, requestKey, kembaliHref, hariIni, minTanggal, bolehMundur }: {
  visitId: string; invoiceId: string; invoiceNo: string; ringkasan: string[]; requestKey: string; kembaliHref: string;
  hariIni?: string; minTanggal?: string | null; bolehMundur?: boolean;
}) {
  const [alasan, setAlasan] = useState("");
  const [paham, setPaham] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilBatal | null>(null);
  const [key] = useState(requestKey);
  const [tanggal, setTanggal] = useState(hariIni ?? "");
  const [teks, setTeks] = useState(ringkasan);
  const [tolakTanggal, setTolakTanggal] = useState<string | null>(null);
  const [sibuk, mulai] = useTransition();
  const [memuat, mulaiMuat] = useTransition();
  const mundur = !!hariIni && !!tanggal && tanggal < hariIni;
  const siap = alasan.replace(/\s/g, "").length >= 3 && paham && !sibuk && !memuat && !tolakTanggal && (!hariIni || !!tanggal);

  const kirim = () => mulai(async () => {
    setPesan(null);
    const f = new FormData();
    f.set("visit_id", visitId); f.set("invoice_id", invoiceId); f.set("reason", alasan); f.set("request_key", key);
    if (bolehMundur && tanggal) f.set("effective_date", tanggal);
    const r = await batalkanPenerimaanKlinik(f);
    if (r.ok) setHasil(r.hasil); else setPesan(r.pesan);
  });

  const ubahTanggal = (nilai: string) => {
    setTanggal(nilai); setPesan(null); setTolakTanggal(null);
    if (!nilai) return;
    mulaiMuat(async () => {
      const r = await pratinjauTanggalBatalPenerimaan(invoiceId, nilai);
      if (!r.ok) { setTolakTanggal(r.pesan); return; }
      setTeks(r.ringkasan); setTolakTanggal(r.tolakTanggal);
    });
  };

  if (hasil) {
    return <div className="card" role="status">
      <div className="card-hd"><span><i className="ti ti-circle-check" /> Penerimaan {hasil.invoice_no} dibatalkan</span></div>
      <ul style={{ fontSize: 11.5, paddingLeft: 18 }}>{ringkasanHasil(hasil).map((t) => <li key={t}>{t}</li>)}</ul>
      <p style={{ fontSize: 11 }}>Langkah berikutnya: ubah tagihan di halaman tagihan (harga, jumlah, baris, BMHP, voucher), lalu terima pembayaran lagi sesuai tagihan yang sudah diubah.{hasil.backdated && hasil.effective_date ? ` Keduanya otomatis dibukukan pada tanggal ${hasil.effective_date}.` : ""}</p>
      <Link href={kembaliHref} className="btn-def"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link>
    </div>;
  }

  return <div className="card">
    <div className="card-hd"><span><i className="ti ti-receipt-off" /> Batalkan penerimaan {invoiceNo}</span></div>
    <p style={{ fontSize: 11 }}>Seperti menghapus penerimaan di Accurate: uang keluar dari kas/bank, tagihan kembali Belum Lunas dengan nomor yang sama, lalu bisa diubah dan diterima lagi sesuai tagihan baru. Tidak ada kredit atau saldo tersembunyi.</p>
    {hariIni && (bolehMundur ? <div style={{ margin: "8px 0" }}>
      <label className="flab" htmlFor="tanggal-efektif">Tanggal pembukuan (efektif)</label>
      <input id="tanggal-efektif" type="date" className="fi" style={{ maxWidth: 180 }} value={tanggal} min={minTanggal ?? undefined} max={hariIni}
        onChange={(e) => ubahTanggal(e.target.value)} />
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>
        Bawaan hari ini ({hariIni}). Pilih tanggal penerimaan asli{minTanggal ? ` (paling awal ${minTanggal})` : ""} agar pembatalan, koreksi, dan penerimaan ulang masuk omzet hari aslinya. Tidak boleh masa depan.
      </div>
      {memuat && <div style={{ fontSize: 10.5 }} role="status">Memeriksa tanggal…</div>}
      {tolakTanggal && <div className="p2ban" role="alert" style={{ marginTop: 6 }}>{tolakTanggal}</div>}
    </div> : <p style={{ fontSize: 10.5, color: "var(--tm)", margin: "6px 0" }}>Tanggal pembukuan: hari ini ({hariIni}). Memilih tanggal mundur hanya untuk Owner.</p>)}
    <div className="p2ban" role="note"><b>Yang akan terjadi (belum ada yang berubah):</b>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{teks.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
    <label className="flab" htmlFor="alasan-batal">Alasan (wajib) *</label>
    <input id="alasan-batal" className="fi" value={alasan} maxLength={500} onChange={(e) => { setAlasan(e.target.value); setPesan(null); }}
      placeholder="mis. harga vaksin salah, disetujui pemilik" />
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginTop: 8 }}>
      <input type="checkbox" checked={paham} onChange={(e) => setPaham(e.target.checked)} />
      Saya paham: uang pelanggan tidak otomatis dikembalikan dari sini; setelah diubah, penerimaan dicatat lagi{mundur ? ` pada tanggal ${tanggal}` : ""}.
    </label>
    {pesan && <div className="p2ban" role="alert" style={{ marginTop: 8 }}>{pesan}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button type="button" className="btn-def" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} disabled={!siap} onClick={kirim}>{sibuk ? "Memproses…" : "Ya, batalkan penerimaan"}</button>
      <Link href={kembaliHref} className="btn-def">Tidak jadi</Link>
    </div>
  </div>;
}
