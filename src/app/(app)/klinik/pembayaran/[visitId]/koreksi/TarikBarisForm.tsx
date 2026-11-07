"use client";
import { useState, useTransition } from "react";
import { labelJurnal, pesanTarikBaris, type BarisTarik, type Pratinjau } from "@/lib/tarik-baris-pesan";
import { pratinjauTarikBaris, tarikBarisLunas } from "./actions";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** "Tarik baris (Owner)": pilih baris yang boleh, lihat pratinjau (stok, jurnal, saldo uang muka), isi alasan, lalu tarik. */
export function TarikBarisForm({ visitId, invoiceId, invoiceNo, lines, requestKey }: {
  visitId: string; invoiceId: string; invoiceNo: string; lines: BarisTarik[]; requestKey: string;
}) {
  const [pilih, setPilih] = useState<string[]>([]);
  const [alasan, setAlasan] = useState("");
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<Pratinjau | null>(null);
  const [key] = useState(requestKey);
  const [sibuk, mulai] = useTransition();

  const buatForm = () => {
    const f = new FormData();
    f.set("visit_id", visitId); f.set("invoice_id", invoiceId); f.set("reason", alasan); f.set("request_key", key);
    pilih.forEach((id) => f.append("line", id));
    return f;
  };
  const ganti = (id: string) => { setPratinjau(null); setPesan(null); setPilih((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const lihat = () => mulai(async () => {
    setPesan(null);
    const r = await pratinjauTarikBaris(buatForm());
    if (r.ok) setPratinjau(r.pratinjau); else { setPratinjau(null); setPesan(r.pesan); }
  });
  const tarik = () => mulai(async () => {
    setPesan(null);
    const r = await tarikBarisLunas(buatForm());
    if (r.ok) { setSelesai(r.pratinjau); setPratinjau(null); } else setPesan(r.pesan);
  });

  if (selesai) {
    return <div className="card" role="status">
      <div className="card-hd"><span><i className="ti ti-circle-check" /> Baris sudah ditarik dari {selesai.invoice_no}</span></div>
      <p>Total tagihan sekarang {rp(selesai.total_after)} (nomor tagihan sama). Saldo uang muka pasien {selesai.advance.no_uang_muka ?? ""} bertambah {rp(selesai.removed_total)}.</p>
      <p style={{ fontSize: 11 }}>Tidak ada uang kas atau bank yang bergerak; sisanya menjadi saldo uang muka pasien dan otomatis dipakai tagihan tahap berikutnya. Sistem belum punya fitur mengembalikan sebagian saldo uang muka lewat transfer: jangan transfer di luar catatan, minta Reza memutuskan pengembaliannya.</p>
    </div>;
  }

  return <div className="card">
    <div className="card-hd"><span><i className="ti ti-arrow-back-up" /> Tarik baris dari tagihan lunas {invoiceNo} (Owner)</span></div>
    <p style={{ fontSize: 11 }}>Baris dihapus dari tagihan yang sama (nomor tidak berubah). Stok bahan kembali, jurnal dibalik hari ini, dan selisihnya menjadi saldo uang muka pasien. Hanya baris penuh yang bisa ditarik.</p>
    <p style={{ fontSize: 11 }} role="note"><b>Penting:</b> nilai baris yang ditarik menjadi <b>saldo uang muka pasien</b>, bukan uang kembali. Fitur mengembalikan saldo uang muka lewat transfer/tunai belum tersedia; jangan transfer di luar catatan, minta Reza memutuskan pengembaliannya.</p>
    <table className="tbl">
      <thead><tr><th /><th>Baris</th><th style={{ textAlign: "right" }}>Jumlah</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "right" }}>HPP</th><th>Keterangan</th></tr></thead>
      <tbody>{lines.map((l) => <tr key={l.invoice_item_id}>
        <td><input type="checkbox" aria-label={`Tarik ${l.deskripsi}`} disabled={!l.eligible || sibuk} checked={pilih.includes(l.invoice_item_id)} onChange={() => ganti(l.invoice_item_id)} /></td>
        <td>{l.deskripsi}</td><td style={{ textAlign: "right" }}>{l.qty}</td><td style={{ textAlign: "right" }}>{rp(l.harga)}</td><td style={{ textAlign: "right" }}>{rp(l.hpp)}</td>
        <td style={{ fontSize: 10.5 }}>{l.eligible ? "Boleh ditarik" : pesanTarikBaris(l.message)}</td></tr>)}</tbody>
    </table>
    <label className="flab" htmlFor="alasan-tarik">Alasan (wajib) *</label>
    <input id="alasan-tarik" className="fi" value={alasan} maxLength={500} onChange={(e) => { setAlasan(e.target.value); setPesan(null); }} placeholder="mis. Infus Refill tidak jadi dipakai, dikonfirmasi pemilik" />
    {pesan && <div className="p2ban" role="alert">{pesan}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button type="button" className="btn-def" disabled={pilih.length === 0 || sibuk} onClick={lihat}>Pratinjau</button>
      <button type="button" className="btn-def" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} disabled={!pratinjau || alasan.replace(/\s/g, "").length < 5 || sibuk} onClick={tarik}>{sibuk ? "Memproses…" : "Tarik baris"}</button>
    </div>
    {pratinjau && <div className="p2ban" role="status" style={{ marginTop: 10 }}>
      <b>Pratinjau (belum ada yang berubah)</b>
      <div>Total tagihan {rp(pratinjau.total_before)} → <b>{rp(pratinjau.total_after)}</b> (dikurangi {rp(pratinjau.removed_total)}), nomor {pratinjau.invoice_no} tetap.</div>
      <div>Kembali ke stok: {pratinjau.stock.length === 0 ? "tidak ada" : pratinjau.stock.map((s) => `${s.qty}× ${s.name} (${rp(s.cost)})`).join(", ")}. HPP dibalik {rp(pratinjau.hpp_removed)}.</div>
      <div>Jurnal hari ini: {pratinjau.journals.map((j) => `${labelJurnal(j.source)} ${rp(j.amount)}`).join("; ")}.</div>
      <div>Saldo uang muka pasien: {rp(pratinjau.advance.balance_before)} → <b>{rp(pratinjau.advance.balance_after)}</b>. Kas/bank tidak bergerak.</div>
    </div>}
  </div>;
}
