"use client";

import { useMemo, useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { formatPosMoney, PosDecimal, posNetTotal, posSubtotal } from "@/lib/pos-money";
import { diskonBaris, METODE_UBAH } from "@/lib/ubah-struk";
import { ubahTransaksi } from "../actions";

type Baris = {
  key: string; asal: string | null; item_id: string; nama: string; qty: number; harga: number; satuan: string;
  diskon_tipe: "nominal" | "percent" | null; diskon_nilai: number; promo: boolean; promo_diskon: number; grup: boolean;
};
type Barang = { id: string; code: string; nama: string; item_type: string; is_active: boolean; units: { unit: string; factor: number }[]; unitHarga: Record<string, number> };
type Bayar = { method: string; amount: number; fee_percent: number };

const num = (text: string) => { const v = Number(text.replace(",", ".")); return Number.isFinite(v) ? v : 0; };

export function UbahStrukForm({ userId, saleId, revision, lines, katalog, diskonKategori, potonganLain, poinDigunakan, payments, punyaPelanggan }: {
  userId: string; saleId: string; revision: number;
  lines: Omit<Baris, "key">[]; katalog: Barang[]; diskonKategori: number; potonganLain: number; poinDigunakan: number;
  payments: Bayar[]; punyaPelanggan: boolean;
}) {
  const byId = useMemo(() => new Map(katalog.map(item => [item.id, item])), [katalog]);
  const pilihan = useMemo(() => katalog.filter(item => item.is_active && item.item_type !== "Grup").map(item => ({ id: item.id, code: item.code, name: item.nama })), [katalog]);
  const [rows, setRows] = useState<Baris[]>(() => lines.map((line, i) => ({ ...line, key: `l${i}` })));
  const [katDisc, setKatDisc] = useState(String(diskonKategori));
  const [lain, setLain] = useState(String(potonganLain));
  const [bayar, setBayar] = useState<Record<string, { amount: string; fee: string }>>(() =>
    Object.fromEntries(METODE_UBAH.map(m => { const p = payments.find(x => x.method === m); return [m, { amount: p ? String(p.amount) : "", fee: p ? String(p.fee_percent || 0) : "0" }]; })));
  const [tambah, setTambah] = useState("");
  const [seq, setSeq] = useState(0);

  const subtotal = posSubtotal(rows);
  const lineDisc = rows.reduce((s, r) => s.plus(diskonBaris({ qty: r.qty, harga: r.harga, item_discount_type: r.diskon_tipe, item_discount_value: r.diskon_nilai, promo_discount: r.promo ? r.promo_diskon : 0 })), new PosDecimal(0)).toNumber();
  const total = posNetTotal(subtotal, lineDisc, num(katDisc), num(lain));
  const dibayar = METODE_UBAH.reduce((s, m) => s.plus(num(bayar[m].amount)), new PosDecimal(0)).toNumber();
  const selisih = new PosDecimal(total).minus(dibayar).toNumber();

  const isian = JSON.stringify({
    lines: rows.map(r => ({ asal: r.asal, item_id: r.item_id, qty: r.qty, harga: r.harga, satuan: r.satuan,
      diskon_tipe: r.diskon_tipe, diskon_nilai: r.diskon_nilai, promo_diskon: r.promo ? r.promo_diskon : 0 })),
    diskon_kategori: num(katDisc), potongan_lain: num(lain),
    payments: METODE_UBAH.filter(m => num(bayar[m].amount) > 0).map(m => ({ method: m, amount: num(bayar[m].amount), fee_percent: m === "Tunai" ? 0 : num(bayar[m].fee) })),
  });
  const valid = rows.length > 0 && rows.every(r => r.qty > 0 && r.harga >= 0 && r.item_id) && Math.abs(selisih) < 0.005 && total >= 0;

  const set = (key: string, patch: Partial<Baris>) => setRows(list => list.map(r => r.key === key ? { ...r, ...patch } : r));
  const addItem = (id: string) => {
    const item = byId.get(id);
    if (!item) return;
    const unit = item.units[0]?.unit ?? "pcs";
    setRows(list => [...list, { key: `n${seq}`, asal: null, item_id: id, nama: item.nama, qty: 1, harga: item.unitHarga[unit] ?? 0, satuan: unit,
      diskon_tipe: null, diskon_nilai: 0, promo: false, promo_diskon: 0, grup: false }]);
    setSeq(n => n + 1); setTambah("");
  };
  const isiSisa = (m: string) => setBayar(b => ({ ...b, [m]: { ...b[m], amount: String(new PosDecimal(num(b[m].amount)).plus(selisih).toNumber()) } }));

  return <CorrectionTransactionForm userId={userId} scope={`sale-edit:${saleId}:${revision}`} action={ubahTransaksi} className="crm-sec">
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="isian" value={isian} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead><tr><th>Barang</th><th>Satuan</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 120 }}>Harga</th><th style={{ width: 120 }}>Diskon baris</th><th style={{ textAlign: "right" }}>Subtotal</th><th /></tr></thead>
          <tbody>
            {rows.map(r => {
              const item = byId.get(r.item_id);
              const units = r.grup ? [{ unit: r.satuan, factor: 1 }] : item?.units ?? [{ unit: r.satuan, factor: 1 }];
              return <tr key={r.key}>
                <td style={{ fontSize: 11.5 }}>{r.nama}{r.promo && <small style={{ display: "block", color: "var(--tm)" }}>Promo lama terbawa</small>}{r.grup && <small style={{ display: "block", color: "var(--tm)" }}>Paket</small>}</td>
                <td><select className="fi" aria-label={`Satuan ${r.nama}`} value={r.satuan} disabled={r.grup}
                  onChange={e => set(r.key, { satuan: e.target.value, ...(r.asal ? {} : { harga: item?.unitHarga[e.target.value] ?? r.harga }) })}>
                  {units.map(u => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                </select></td>
                <td><input className="fi" aria-label={`Qty ${r.nama}`} type="number" min="0.001" step="any" inputMode="decimal" value={r.qty} onChange={e => set(r.key, { qty: num(e.target.value) })} /></td>
                <td><input className="fi" aria-label={`Harga ${r.nama}`} type="number" min="0" step="0.01" inputMode="decimal" value={r.harga} onChange={e => set(r.key, { harga: num(e.target.value) })} /></td>
                <td>{r.promo
                  ? <input className="fi" aria-label={`Diskon promo ${r.nama}`} type="number" min="0" step="0.01" value={r.promo_diskon} onChange={e => set(r.key, { promo_diskon: num(e.target.value) })} />
                  : <input className="fi" aria-label={`Diskon ${r.nama}`} type="number" min="0" step="0.01" value={r.diskon_tipe === "percent" ? r.diskon_nilai : r.diskon_nilai || ""} placeholder="0"
                    onChange={e => set(r.key, { diskon_tipe: r.diskon_tipe === "percent" ? "percent" : "nominal", diskon_nilai: num(e.target.value) })} />}
                  {r.diskon_tipe === "percent" && !r.promo && <small>%</small>}</td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>{formatPosMoney(new PosDecimal(r.qty).times(r.harga).toNumber())}</td>
                <td><button type="button" className="btn-def" aria-label={`Hapus ${r.nama}`} onClick={() => setRows(list => list.filter(x => x.key !== r.key))}><i className="ti ti-trash" /></button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, maxWidth: 420 }}>
        <label className="flab" htmlFor="ubah-tambah">Tambah barang</label>
        <SearchableItemPicker inputId="ubah-tambah" items={pilihan} value={tambah} onChange={id => { setTambah(id); if (id) addItem(id); }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
        <div><label className="flab" htmlFor="ubah-kat">Diskon golongan pelanggan</label>
          <input id="ubah-kat" className="fi" type="number" min="0" step="0.01" value={katDisc} onChange={e => setKatDisc(e.target.value)} disabled={!punyaPelanggan && num(katDisc) === 0} /></div>
        <div><label className="flab" htmlFor="ubah-lain">Potongan lain (voucher, poin, diskon total)</label>
          <input id="ubah-lain" className="fi" type="number" min="0" step="0.01" value={lain} onChange={e => setLain(e.target.value)} />
          {poinDigunakan > 0 && <small>Termasuk {poinDigunakan.toLocaleString("id-ID")} poin yang dipakai (tetap).</small>}</div>
      </div>
      <p style={{ marginTop: 10 }}>Subtotal {formatPosMoney(subtotal)} · diskon baris {formatPosMoney(lineDisc)} · <strong>Total {formatPosMoney(total)}</strong></p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {METODE_UBAH.map(m => <div key={m}>
          <label className="flab" htmlFor={`ubah-bayar-${m}`}>{m}</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input id={`ubah-bayar-${m}`} className="fi" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={bayar[m].amount}
              onChange={e => setBayar(b => ({ ...b, [m]: { ...b[m], amount: e.target.value } }))} />
            {m !== "Tunai" && <input className="fi" aria-label={`Fee ${m} persen`} title="Fee merchant %" type="number" min="0" max="100" step="0.01" style={{ maxWidth: 70 }} value={bayar[m].fee}
              onChange={e => setBayar(b => ({ ...b, [m]: { ...b[m], fee: e.target.value } }))} />}
          </div>
          {Math.abs(selisih) >= 0.005 && <button type="button" className="btn-def" style={{ fontSize: 10.5, marginTop: 3 }} onClick={() => isiSisa(m)}>Isi sisa {formatPosMoney(selisih)} ke {m}</button>}
        </div>)}
      </div>
      <p role="status">{Math.abs(selisih) < 0.005 ? "Pembayaran sudah sama dengan total." : selisih > 0 ? `Pembayaran kurang ${formatPosMoney(selisih)}.` : `Pembayaran lebih ${formatPosMoney(-selisih)}.`} Fee merchant (kolom %) ditambahkan di atas total seperti di kasir.</p>
      <label className="flab" htmlFor="ubah-alasan">Alasan perubahan *</label>
      <input id="ubah-alasan" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: kasir salah input jumlah barang" />
      <button className="btn-acc" type="submit" disabled={!ready || !valid} style={{ marginTop: 10 }}>Simpan perubahan</button>
    </>}
  </CorrectionTransactionForm>;
}
