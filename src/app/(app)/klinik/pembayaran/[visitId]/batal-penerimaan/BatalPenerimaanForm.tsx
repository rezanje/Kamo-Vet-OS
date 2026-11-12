"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ringkasanHasil, type HasilBatal } from "@/lib/batal-penerimaan-pesan";
import { UBAH_TANGGAL_CATATAN, UBAH_TANGGAL_LABEL } from "@/lib/tanggal-pembukuan-copy";
import { batalkanPenerimaanKlinik, pratinjauTanggalBatalPenerimaan } from "./actions";

/**
 * "Batalkan penerimaan": satu kalimat akibat, rincian dari pratinjau database, alasan wajib, satu persetujuan, lalu satu kali kirim.
 * Tanggal pembukuan: bawaan hari ini; hanya Owner (atau peran berizin) melihat kontrol kecil tertutup untuk mengubahnya.
 * Peran lain tidak melihat kata apa pun tentang tanggal. Database memutuskan sah-tidaknya tanggal (periode terkunci, batas, hak).
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
      <p style={{ fontSize: 11 }}>Berikutnya: ubah transaksi di faktur, lalu terima pembayaran lagi.</p>
      <Link href={kembaliHref} className="btn-def"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link>
    </div>;
  }

  return <div className="card">
    <div className="card-hd"><span><i className="ti ti-receipt-off" /> Batalkan penerimaan {invoiceNo}</span></div>
    <p style={{ fontSize: 11 }}>Nota kembali belum lunas. Setelah itu ubah transaksi di faktur, lalu terima pembayaran lagi.</p>
    <ul role="note" style={{ margin: "6px 0", paddingLeft: 18, fontSize: 11 }}>{teks.map((t) => <li key={t}>{t}</li>)}</ul>
    {hariIni && bolehMundur && <details style={{ margin: "8px 0" }} data-testid="ubah-tanggal-pembukuan">
      <summary style={{ cursor: "pointer", fontSize: 11 }}>{UBAH_TANGGAL_LABEL}</summary>
      <label className="flab" htmlFor="tanggal-efektif">Tanggal pembukuan</label>
      <input id="tanggal-efektif" type="date" className="fi" style={{ maxWidth: 180 }} value={tanggal} min={minTanggal ?? undefined} max={hariIni}
        onChange={(e) => ubahTanggal(e.target.value)} />
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>{UBAH_TANGGAL_CATATAN}</div>
      {memuat && <div style={{ fontSize: 10.5 }} role="status">Memeriksa tanggal…</div>}
      {tolakTanggal && <div className="p2ban" role="alert" style={{ marginTop: 6 }}>{tolakTanggal}</div>}
    </details>}
    <label className="flab" htmlFor="alasan-batal">Alasan *</label>
    <input id="alasan-batal" className="fi" value={alasan} maxLength={500} onChange={(e) => { setAlasan(e.target.value); setPesan(null); }}
      placeholder="mis. harga vaksin salah, disetujui pemilik" />
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginTop: 8 }}>
      <input type="checkbox" checked={paham} onChange={(e) => setPaham(e.target.checked)} />
      Saya paham: uang pelanggan tidak otomatis dikembalikan dari sini.
    </label>
    {pesan && <div className="p2ban" role="alert" style={{ marginTop: 8 }}>{pesan}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button type="button" className="btn-def" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} disabled={!siap} onClick={kirim}>{sibuk ? "Memproses…" : "Ya, batalkan penerimaan"}</button>
      <Link href={kembaliHref} className="btn-def">Tidak jadi</Link>
    </div>
  </div>;
}
