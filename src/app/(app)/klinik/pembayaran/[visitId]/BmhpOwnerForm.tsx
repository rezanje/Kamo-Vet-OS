"use client";
import { useState, useTransition } from "react";
import { muatanKomponen, PERINGATAN_HPP_BEDA_BAHAN, type KomponenBmhp, type PratinjauBmhp } from "@/lib/bmhp-owner";
import { pratinjauBmhp, simpanBmhp } from "./bmhp-owner-actions";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
export type BahanMaster = { id: string; name: string; unit: string };

/** "Ubah BMHP (Owner)": jumlah tiap bahan bisa diubah (kosong/0 = keluarkan), bahan lain bisa ditambah dari master. Pratinjau dulu, alasan wajib, lalu simpan.
 *  mode "pending" = baris masih di keranjang kasir (belum ditagih, stok belum keluar); "tagihan" = baris sudah di invoice (stok selisih + jurnal HPP hari ini). */
export function BmhpOwnerForm({ mode, visitId, recordId = "", targetId, snapshot = "", title, price, components, master, requestKey }: {
  mode: "pending" | "tagihan"; visitId: string; recordId?: string; targetId: string; snapshot?: string; title: string; price: number;
  components: KomponenBmhp[]; master: BahanMaster[]; requestKey?: string;
}) {
  const [rows, setRows] = useState<{ item_id: string; name: string; qty: string; unit: string | null; asal: boolean }[]>(
    components.map((c) => ({ item_id: c.item_id, name: c.name ?? c.item_id, qty: String(c.qty), unit: c.unit ?? null, asal: true })));
  const [baru, setBaru] = useState("");
  const [alasan, setAlasan] = useState("");
  const [pratinjau, setPratinjau] = useState<PratinjauBmhp | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<PratinjauBmhp | null>(null);
  const [key] = useState(() => requestKey || crypto.randomUUID());
  const [sibuk, mulai] = useTransition();
  const [terbuka, setTerbuka] = useState(false);

  const buatForm = () => {
    const f = new FormData();
    f.set("mode", mode); f.set("visit_id", visitId); f.set("record_id", recordId); f.set("target_id", targetId); f.set("snapshot", snapshot);
    f.set("reason", alasan); f.set("request_key", key);
    f.set("components", JSON.stringify(rows.map((r) => ({ item_id: r.item_id, qty: r.qty, unit: r.unit }))));
    return f;
  };
  const ubah = (id: string, qty: string) => { setPratinjau(null); setPesan(null); setRows((p) => p.map((r) => r.item_id === id ? { ...r, qty } : r)); };
  const tambah = () => {
    const m = master.find((x) => x.id === baru);
    if (!m || rows.some((r) => r.item_id === m.id)) return;
    setPratinjau(null); setPesan(null); setRows((p) => [...p, { item_id: m.id, name: m.name, qty: "1", unit: null, asal: false }]); setBaru("");
  };
  const valid = muatanKomponen(rows.map((r) => ({ item_id: r.item_id, qty: r.qty })));
  const lihat = () => mulai(async () => {
    setPesan(null);
    const r = await pratinjauBmhp(buatForm());
    if (r.ok) setPratinjau(r.pratinjau); else { setPratinjau(null); setPesan(r.pesan); }
  });
  const simpan = () => mulai(async () => {
    setPesan(null);
    const r = await simpanBmhp(buatForm());
    if (r.ok) { setSelesai(r.pratinjau); setPratinjau(null); } else setPesan(r.pesan);
  });

  if (selesai) {
    return <div className="p2ban" role="status">
      <b>BMHP {title} sudah diubah.</b> HPP {rp(selesai.hpp_before)} → <b>{rp(selesai.hpp_after)}</b>.
      {mode === "pending" ? " Keranjang dimuat ulang; lanjutkan dengan Simpan atau Bayar seperti biasa." : " Harga, total tagihan, dan pembayaran tidak berubah."}
      {mode === "tagihan" && selesai.hpp_differs_from_cost && <div role="alert" style={{ marginTop: 6 }}>{PERINGATAN_HPP_BEDA_BAHAN}</div>}
    </div>;
  }
  if (!terbuka) return <button type="button" className="btn-def" onClick={() => setTerbuka(true)}><i className="ti ti-flask" /> Ubah BMHP (Owner)</button>;

  const bolehSimpan = !!pratinjau && valid.ok && alasan.replace(/\s/g, "").length >= 5 && !sibuk && (mode === "tagihan" || pratinjau.can_post_after !== false);
  const sisa = components.filter((c) => !rows.some((r) => r.item_id === c.item_id));
  return <div className="card" style={{ marginTop: 8 }}>
    <div className="card-hd"><span><i className="ti ti-flask" /> Ubah BMHP (Owner): {title} · harga jual {rp(price)}</span></div>
    <p style={{ fontSize: 11 }}>
      {mode === "pending"
        ? "Baris ini belum ditagih, jadi stok belum keluar: hanya daftar bahan yang diubah dan berlaku saat tagihan diterbitkan. Harga jual tidak berubah dan batas harga di bawah HPP tetap berlaku."
        : "Baris ini sudah ada di tagihan. Selisih stok dikembalikan atau dikeluarkan sekarang, HPP baris diperbarui, dan selisih HPP dijurnal hari ini. Harga, total tagihan, dan pembayaran tidak berubah."}
    </p>
    <table className="tbl">
      <thead><tr><th>Bahan</th><th style={{ textAlign: "right" }}>Jumlah</th><th>Satuan</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.item_id}>
        <td>{r.name}{!r.asal && " (baru)"}</td>
        <td style={{ textAlign: "right" }}><input className="fi" style={{ width: 90, textAlign: "right" }} inputMode="decimal" aria-label={`Jumlah ${r.name}`} value={r.qty} disabled={sibuk} onChange={(e) => ubah(r.item_id, e.target.value)} /></td>
        <td>{r.unit ?? "satuan dasar"}</td></tr>)}
        {sisa.map((c) => <tr key={c.item_id}><td colSpan={3} style={{ fontSize: 10.5 }}>{c.name ?? c.item_id}: dikeluarkan dari daftar</td></tr>)}
      </tbody>
    </table>
    <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
      <select className="fi" aria-label="Tambah bahan" value={baru} onChange={(e) => setBaru(e.target.value)}>
        <option value="">Tambah bahan lain…</option>
        {master.filter((m) => !rows.some((r) => r.item_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
      </select>
      <button type="button" className="btn-def" disabled={!baru || sibuk} onClick={tambah}>Tambah</button>
    </div>
    <label className="flab" htmlFor={`alasan-${targetId}`}>Alasan (wajib) *</label>
    <input id={`alasan-${targetId}`} className="fi" value={alasan} maxLength={500} onChange={(e) => { setAlasan(e.target.value); setPesan(null); }} placeholder="mis. Lacto-B per suntik 3,4 bukan 5, sesuai pemakaian" />
    {!valid.ok && <div className="p2ban" role="alert" style={{ marginTop: 6 }}>{valid.pesan}</div>}
    {pesan && <div className="p2ban" role="alert" style={{ marginTop: 6 }}>{pesan}</div>}
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button type="button" className="btn-def" disabled={!valid.ok || sibuk} onClick={lihat}>Pratinjau</button>
      <button type="button" className="btn-def" disabled={!bolehSimpan} onClick={simpan}>{sibuk ? "Memproses…" : "Simpan perubahan BMHP"}</button>
      <button type="button" className="btn-def" disabled={sibuk} onClick={() => setTerbuka(false)}>Tutup</button>
    </div>
    {pratinjau && <div className="p2ban" role="status" style={{ marginTop: 10 }}>
      <b>Pratinjau (belum ada yang berubah)</b>
      <div>Harga jual {rp(pratinjau.price)}. HPP {rp(pratinjau.hpp_before)} → <b>{rp(pratinjau.hpp_after)}</b>.</div>
      {pratinjau.floor_applies && (pratinjau.price_below_hpp_after
        ? <div role="alert">Harga masih di bawah HPP baru: {mode === "pending" ? "kasir tetap akan menolak. Turunkan jumlah bahan lagi atau naikkan harga lewat alur yang ada." : "perubahan ini membuat tagihan rugi pada baris ini (tetap bisa disimpan, tercatat di audit)."}</div>
        : <div>Harga tidak di bawah HPP baru: batas harga lolos.</div>)}
      {mode === "pending" && pratinjau.sim_error_after && <div role="alert">Belum bisa diproses: {pratinjau.sim_error_after}</div>}
      {mode === "tagihan" && pratinjau.stock && <div>Stok: {pratinjau.stock.length === 0 ? "tidak ada pergerakan" : pratinjau.stock.map((s) => `${s.direction} ${Math.abs(s.delta)}× ${s.name ?? ""}`).join(", ")}.</div>}
      {mode === "tagihan" && pratinjau.journal && <div>Jurnal {pratinjau.journal.date}: {pratinjau.journal.lines.map((l) => `${l.code} ${l.debit > 0 ? "Dr " + rp(l.debit) : "Cr " + rp(l.credit)}`).join("; ")}.</div>}
      {mode === "tagihan" && pratinjau.hpp_differs_from_cost && <div role="alert" style={{ marginTop: 4 }}>{PERINGATAN_HPP_BEDA_BAHAN}</div>}
    </div>}
  </div>;
}
