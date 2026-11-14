"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ALASAN_BATAL_MAX, ALASAN_BATAL_MIN, ringkasanHasilBatalTagihan, type HasilBatalTagihan } from "@/lib/batal-tagihan-klinik";
import { batalkanTagihanKlinik } from "./actions";

/**
 * "Batalkan tagihan" (B2): rincian akibat dari pratinjau database, alasan wajib, satu persetujuan, lalu satu kali kirim dengan kunci tetap.
 * Sesudah berhasil: langkah berikutnya (arsip paksa di Antrian; DP dikembalikan lewat panel saldo uang muka di halaman ini).
 */
export function BatalTagihanForm({ visitId, invoiceId, invoiceNo, ringkasan, requestKey, kembaliHref, halamanIni }: {
  visitId: string; invoiceId: string; invoiceNo: string; ringkasan: string[]; requestKey: string; kembaliHref: string; halamanIni: string;
}) {
  const [alasan, setAlasan] = useState("");
  const [paham, setPaham] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilBatalTagihan | null>(null);
  const [key] = useState(requestKey);
  const [sibuk, mulai] = useTransition();
  const siap = alasan.replace(/\s/g, "").length >= ALASAN_BATAL_MIN && paham && !sibuk;

  const kirim = () => mulai(async () => {
    setPesan(null);
    const f = new FormData();
    f.set("visit_id", visitId); f.set("invoice_id", invoiceId); f.set("reason", alasan); f.set("request_key", key);
    const r = await batalkanTagihanKlinik(f);
    if (r.ok) setHasil(r.hasil); else setPesan(r.pesan);
  });

  if (hasil) {
    return <div className="card" role="status">
      <div className="card-hd"><span><i className="ti ti-circle-check" /> Tagihan {hasil.invoice_no} dibatalkan</span></div>
      <ul style={{ fontSize: 11.5, paddingLeft: 18 }}>{ringkasanHasilBatalTagihan(hasil).map((t) => <li key={t}>{t}</li>)}</ul>
      <p style={{ fontSize: 11 }}>Berikutnya: arsipkan kunjungannya lewat &quot;Paksa arsip&quot; di Antrian{Number(hasil.dp_converted) > 0 ? ", setelah DP dikembalikan ke pelanggan" : ""}.</p>
      <div style={{ display: "flex", gap: 8 }}>
        {Number(hasil.dp_converted) > 0 && <a href={halamanIni} className="btn-def"><i className="ti ti-cash-banknote" /> Kembalikan DP ke pelanggan</a>}
        <Link href="/klinik/antrian" className="btn-def"><i className="ti ti-users" /> Ke Antrian</Link>
        <Link href={kembaliHref} className="btn-def"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link>
      </div>
    </div>;
  }

  return <div className="card">
    <div className="card-hd"><span><i className="ti ti-file-x" /> Batalkan tagihan {invoiceNo}</span></div>
    <p style={{ fontSize: 11 }}>Tagihan dibatalkan tanpa tagihan pengganti. Yang terjadi:</p>
    <ul role="note" style={{ margin: "6px 0", paddingLeft: 18, fontSize: 11 }}>{ringkasan.map((t) => <li key={t}>{t}</li>)}</ul>
    <label className="flab" htmlFor="alasan-batal-tagihan">Alasan *</label>
    <input id="alasan-batal-tagihan" className="fi" value={alasan} maxLength={ALASAN_BATAL_MAX} onChange={(e) => { setAlasan(e.target.value); setPesan(null); }}
      placeholder="mis. data percobaan kasir, pasien batal" />
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginTop: 8 }}>
      <input type="checkbox" checked={paham} onChange={(e) => setPaham(e.target.checked)} />
      Saya paham: tagihan ini tidak bisa dipakai lagi; kalau masih perlu ditagih, buat tagihan baru.
    </label>
    {pesan && <div className="p2ban" role="alert" style={{ marginTop: 8 }}>{pesan}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button type="button" className="btn-def" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} disabled={!siap} onClick={kirim}>{sibuk ? "Memproses…" : "Ya, batalkan tagihan"}</button>
      <Link href={kembaliHref} className="btn-def">Tidak jadi</Link>
    </div>
  </div>;
}
