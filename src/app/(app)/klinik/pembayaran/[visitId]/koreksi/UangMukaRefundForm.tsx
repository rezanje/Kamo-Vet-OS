"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ajukanRefundUangMuka } from "./uang-muka-refund-actions";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Jumlah ditulis "30.000" / "30000" / "1000,5" -> angka (null bila tidak valid). Sama dengan aturan aksi server. */
function angka(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : NaN;
  return Number.isFinite(n) && Math.round(n * 100) / 100 === n ? n : null;
}

/** "Kembalikan saldo uang muka": jumlah (maks. seluruh saldo), tujuan transfer, alasan. Hanya mengajukan: Finance menyelesaikannya di antrean refund setelah transfer. */
export function UangMukaRefundForm({ advanceId, noUangMuka, saldo, requestKey }: { advanceId: string; noUangMuka: string; saldo: number; requestKey: string }) {
  const [jumlah, setJumlah] = useState(String(saldo));
  const [bank, setBank] = useState(""); const [rek, setRek] = useState(""); const [nama, setNama] = useState(""); const [alasan, setAlasan] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<string | null>(null);
  const [key] = useState(requestKey);
  const [sibuk, mulai] = useTransition();

  if (saldo <= 0) return <p style={{ fontSize: 11 }}>Uang muka {noUangMuka}: tidak ada saldo yang belum terpakai untuk dikembalikan.</p>;
  if (selesai) {
    return <div className="p2ban" role="status"><i className="ti ti-circle-check" /> Pengajuan {selesai} dibuat dan jumlahnya dicadangkan (tidak bisa terpakai tagihan lain). Belum ada uang yang bergerak: Finance mengambil proses dan mencatat transfer selesai di antrean refund.{" "}
      <Link href="/kas-bank/refund?status=pending">Buka antrean refund Finance</Link></div>;
  }
  const n = angka(jumlah);
  const lebih = n !== null && n > saldo;
  const valid = n !== null && n > 0 && !lebih && bank.trim() !== "" && /^[A-Za-z0-9 -]{3,40}$/.test(rek.trim()) && nama.trim() !== "" && alasan.replace(/\s/g, "").length >= 5;
  const ajukan = () => mulai(async () => {
    setPesan(null);
    const f = new FormData();
    f.set("advance_id", advanceId); f.set("amount", String(n)); f.set("bank", bank); f.set("account", rek); f.set("holder", nama); f.set("reason", alasan); f.set("request_key", key);
    const r = await ajukanRefundUangMuka(f);
    if (r.ok) setSelesai(r.noRefund); else setPesan(r.pesan);
  });

  return <div style={{ marginTop: 6 }}>
    <p style={{ fontSize: 11 }}>Uang muka <b>{noUangMuka}</b>: saldo belum terpakai <b>{rp(saldo)}</b>. Pengajuan mencadangkan jumlahnya; uang baru keluar dari bank setelah Finance mentransfer dan mencatatnya.</p>
    <label className="flab" htmlFor="rum-jumlah">Jumlah dikembalikan (Rp) *</label>
    <input id="rum-jumlah" className="fi" inputMode="decimal" value={jumlah} onChange={(e) => { setJumlah(e.target.value); setPesan(null); }} />
    {lebih && <div className="p2ban" role="note">Jumlah tidak boleh melebihi saldo {rp(saldo)}.</div>}
    <label className="flab" htmlFor="rum-bank">Bank tujuan *</label>
    <input id="rum-bank" className="fi" value={bank} maxLength={80} onChange={(e) => setBank(e.target.value)} placeholder="mis. BCA" />
    <label className="flab" htmlFor="rum-rek">Nomor rekening tujuan *</label>
    <input id="rum-rek" className="fi" value={rek} maxLength={40} onChange={(e) => setRek(e.target.value)} />
    <label className="flab" htmlFor="rum-nama">Nama pemilik rekening *</label>
    <input id="rum-nama" className="fi" value={nama} maxLength={120} onChange={(e) => setNama(e.target.value)} />
    <label className="flab" htmlFor="rum-alasan">Alasan (wajib) *</label>
    <input id="rum-alasan" className="fi" value={alasan} maxLength={500} onChange={(e) => { setAlasan(e.target.value); setPesan(null); }} placeholder="mis. sisa uang muka dikembalikan ke pemilik atas keputusan Andri" />
    {pesan && <div className="p2ban" role="alert">{pesan}</div>}
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn-def" disabled={!valid || sibuk} onClick={ajukan}>{sibuk ? "Memproses…" : "Ajukan pengembalian"}</button>
    </div>
  </div>;
}
