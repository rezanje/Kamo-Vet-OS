"use client";

import { NumberInput } from "@/components/NumberInput";

// ponytail: dynamic item rows serialized to hidden JSON, same pattern as PermintaanForm.

import { usePreservedAction } from "@/components/LocalTransactionDraft";
import { PurchasePriceInput } from "@/components/PurchasePriceInput";
import { PurchaseRequestKey } from "@/components/PurchaseRequestKey";
import { draftRows } from "@/components/TransactionDraft";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WarehouseStock } from "@/lib/warehouse-stock";
import { WarehouseStockHint } from "@/components/WarehouseStockHint";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { SecHeader } from "@/components/SecHeader";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { buatPO } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";
import { PriceDeviationConfirm } from "@/components/PriceDeviationConfirm";

type Supplier = { id: string; nama: string };
type Warehouse = { id: string; name: string };
type Branch = { id: string; name: string };
export type Item = { id: string; code: string; name: string; unit: string; buy_price: number; item_type?: string; units: ItemUnit[] };
type Row = { nama: string; qty: number; harga_beli: number; item_id?: string | null; satuan?: string; faktor?: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { nama: "", qty: 1, harga_beli: 0, item_id: null, satuan: "", faktor: 1 };
const itemLabel = (it: Item) => `${it.code} — ${it.name}`;

export function POForm({
  userId,
  suppliers,
  warehouses,
  branches,
  items,
  stock = [],
  priceWarning,
}: {
  userId: string;
  suppliers: Supplier[];
  warehouses: Warehouse[];
  branches: Branch[];
  items: Item[];
  stock?: WarehouseStock[];
  /** P04: peringatan harga dari server saat simpan terakhir. */
  priceWarning?: string;
}) {
  const { save, failure } = usePreservedAction(buatPO);
  const [warehouseId, setWarehouseId] = useState("");
  const warehouseSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const select = warehouseSelect.current;
    const restore = (event: Event) => setWarehouseId((event as CustomEvent<string>).detail);
    select?.addEventListener("vetos:draft-restore", restore);
    return () => select?.removeEventListener("vetos:draft-restore", restore);
  }, []);
  const stockByItem = new Map(stock.filter(s => s.warehouse_id === warehouseId).map(s => [s.item_id, Number(s.qty)]));
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const byId = new Map(items.map((it) => [it.id, it]));
  const unitsOf = (r: Row) => (r.item_id ? byId.get(r.item_id)?.units ?? [] : []);

  // Pilih dari master SKU → link item_id + prefill harga beli; teks bebas tetap boleh (item_id null).
  const setNama = (i: number, v: string) => {
    // Recognize the old exact code/name label only when unambiguous. Ordinary
    // typed names stay free text; selecting an option supplies the actual ID.
    const matches = items.filter(it => itemLabel(it) === v);
    const it = matches.length === 1 ? matches[0] : undefined;
    const dasar = it?.units[0];
    set(i, it
      ? { nama: v, item_id: it.id, harga_beli: dasar?.buy_price || Number(it.buy_price) || 0, satuan: dasar?.unit ?? it.unit ?? "", faktor: 1 }
      : { nama: v, item_id: null, satuan: "", faktor: 1 });
  };
  const chooseItem = (i: number, id: string) => {
    const it = byId.get(id);
    if (!it) return;
    const dasar = it.units[0];
    set(i, { nama: it.name, item_id: it.id, harga_beli: dasar?.buy_price || Number(it.buy_price) || 0, satuan: dasar?.unit ?? it.unit ?? "", faktor: 1 });
  };
  const displayName = (row: Row) => {
    const item = row.item_id ? byId.get(row.item_id) : undefined;
    return item && row.nama === itemLabel(item) ? item.name : row.nama;
  };

  // Beli per box → harga beli & faktor ikut satuan yang dipilih.
  const setSatuan = (i: number, r: Row, unit: string) => {
    const u = pickUnit(unitsOf(r), unit);
    if (!u) return;
    set(i, { satuan: u.unit, faktor: u.factor, harga_beli: u.buy_price || r.harga_beli });
  };
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const total = rows.reduce(
    (acc, r) => acc + (Number(r.qty) || 0) * (Number(r.harga_beli) || 0),
    0
  );

  const today = hariIniWIB();

  return (
    <form action={save}>
      <PurchaseRequestKey userId={userId} scope="po-create" draft={{ snapshot: { rows, warehouseId }, restore: (value) => {
        if (!draftRows(value.rows, blank)) return false;
        setRows(value.rows); if (typeof value.warehouseId === "string") setWarehouseId(value.warehouseId); return true;
      }, reset: () => { setRows([{ ...blank }]); setWarehouseId(""); } }} />
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <input type="hidden" name="items" value={JSON.stringify(rows)} />

      <div className="grid2" style={{gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,320px),1fr))"}}>
        {/* Kolom kiri: detail PO */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL PO" desc="Supplier, gudang tujuan & cabang." />

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Supplier</label>
            <select className="fi" name="supplier_id">
              <option value="">— Tanpa supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nama}</option>
              ))}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Tambah supplier baru di halaman{" "}
              <Link href="/pembelian?tab=supplier" style={{ color: "var(--tm)" }}>Pembelian → Supplier</Link>.
            </div>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang tujuan *</label>
            <select className="fi" name="to_warehouse_id" required ref={warehouseSelect} data-draft-state value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Cabang *</label>
            <select className="fi" name="branch_id" required>
              <option value="">Pilih cabang</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal PO</label>
            <input className="fi" type="date" name="tanggal" defaultValue={today} />
          </div>

          {total > 0 && (
            <div style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "var(--bg2, #f9fafb)",
              borderRadius: 6,
              border: ".5px solid var(--bd)",
              fontSize: 13,
              fontWeight: 700,
              display: "flex",
              justifyContent: "space-between",
            }}>
              <span style={{ color: "var(--tm)", fontWeight: 500 }}>Total PO</span>
              <span>{rp(total)}</span>
            </div>
          )}
        </div>

        {/* Kolom kanan: item rows */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader
            num="02"
            title="DAFTAR ITEM"
            desc="Nama barang, jumlah, satuan, & harga beli per satuan."
            action={
              <button
                type="button"
                onClick={add}
                className="btn-def"
                style={{ padding: "4px 10px", fontSize: 10.5 }}
              >
                + Tambah baris
              </button>
            }
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => {
              const opts = unitsOf(r);
              const dasar = opts[0]?.unit;
              const faktor = Number(r.faktor) || 1;
              return (
                <div key={i}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <SearchableItemPicker items={items} value={r.item_id ?? ""} textValue={displayName(r)}
                        onTextChange={text => setNama(i, text)} onChange={id => chooseItem(i, id)} ariaLabel={`Barang PO ${i + 1}`} />
                    </div>
                    <NumberInput
                      className="fi"
                      type="number"
                      min={0}
                      step="any"
                      value={r.qty}
                      onChange={(e) => set(i, { qty: Number(e.target.value) })}
                      style={{ width: 62 }}
                      title="Qty"
                      placeholder="Qty"
                    />
                    {/* Satuan berjenjang dari master SKU; item teks bebas tetap tanpa satuan. */}
                    {opts.length > 1 ? (
                      <select
                        className="fi"
                        value={r.satuan || ""}
                        onChange={(e) => setSatuan(i, r, e.target.value)}
                        style={{ width: 74, flexShrink: 0, padding: "3px 5px", fontSize: 10.5 }}
                        title="Satuan beli"
                      >
                        {opts.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                      </select>
                    ) : (
                      <span
                        style={{ width: 74, flexShrink: 0, fontSize: 10.5, color: r.satuan ? "var(--tm)" : "var(--td)" }}
                        title="Satuan (dari master SKU)"
                      >
                        {r.satuan || "—"}
                      </span>
                    )}
                    <PurchasePriceInput price={r.harga_beli} onChange={value=>set(i,{harga_beli:value})} label={`Harga beli per ${r.satuan || "satuan"}`} />
                    <button
                      type="button"
                      onClick={() => del(i)}
                      className="btn-def"
                      style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0 }}
                      title="Hapus baris"
                    >
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                  {r.item_id && (!byId.get(r.item_id)?.item_type || byId.get(r.item_id)?.item_type === "Persediaan") && (
                    <WarehouseStockHint warehouseId={warehouseId} quantity={stockByItem.get(r.item_id) ?? 0} baseUnit={byId.get(r.item_id)?.unit ?? dasar ?? "pcs"} selectedUnit={opts.find(u => u.unit === r.satuan)} />
                  )}
                  {faktor !== 1 && dasar && (
                    <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>
                      Stok masuk {(Number(r.qty) || 0) * faktor} {dasar} ({faktor} {dasar} per {r.satuan})
                      {Number(r.harga_beli) > 0 && ` · modal ≈ ${rp(Number(r.harga_beli) / faktor)}/${dasar}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Pilih dari daftar master SKU agar stok otomatis bertambah saat PO diterima (dan bisa diretur).
            Baris tanpa nama diabaikan.
          </div>
        </div>
      </div>

      <PriceDeviationConfirm warning={priceWarning} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Link href="/pembelian" className="btn-def" style={{ textDecoration: "none" }}>
          Batal
        </Link>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan PO
        </button>
      </div>
    </form>
  );
}
