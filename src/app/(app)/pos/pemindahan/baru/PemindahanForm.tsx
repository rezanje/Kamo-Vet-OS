"use client";

import { NumberInput } from "@/components/NumberInput";

import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { LocalTransactionDraft, usePreservedAction } from "@/components/LocalTransactionDraft";
import type { ItemUnit } from "@/lib/satuan";
import { useEffect, useRef, useState } from "react";
import type { WarehouseStock } from "@/lib/warehouse-stock";
import { WarehouseStockHint } from "@/components/WarehouseStockHint";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buatKirim } from "../actions";
import { kurangStokPemindahan } from "@/lib/pemindahan";
import { hariIniWIB } from "@/lib/tanggal";

type Warehouse = { id: string; name: string };
type Item = { id: string; code: string; name: string; unit: string; units: ItemUnit[] };
type Row = { display: string; item_id: string; qty: number; satuan: string };

const blank: Row = { display: "", item_id: "", qty: 1, satuan: "" };
const label = (it: Item) => `${it.code} — ${it.name}`;

export function PemindahanForm({ warehouses, items, userId, stock = [] }: { warehouses: Warehouse[]; items: Item[]; userId: string; stock?: WarehouseStock[] }) {
  const { save, failure } = usePreservedAction(buatKirim);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
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

  const byLabel = new Map(items.map((it) => [label(it), it]));
  const byId = new Map(items.map(item => [item.id, item]));

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const onDisplay = (i: number, v: string) => {
    const it = byLabel.get(v);
    set(i, { display: it?.name ?? v, item_id: it?.id ?? "", satuan: it?.units[0]?.unit ?? "" });
  };

  const payload = rows.filter((r) => r.item_id).map((r) => ({ item_id: r.item_id, qty: r.qty, satuan: r.satuan }));

  // Kekurangan stok dihentikan di layar gudang asal, bukan menunggu penolakan
  // database setelah tombol ditekan — dan disebutkan per barang.
  const kurang = warehouseId
    ? kurangStokPemindahan(
        payload.map((r) => {
          const it = byId.get(r.item_id);
          return {
            item_id: r.item_id,
            nama: it?.name ?? "Barang",
            qty: Number(r.qty) || 0,
            faktor: Number(it?.units.find((u) => u.unit === r.satuan)?.factor) || 1,
            satuan: r.satuan || it?.unit || "",
          };
        }),
        stockByItem,
      )
    : null;

  return (
    <form action={save}>
      <LocalTransactionDraft userId={userId} scope="pos:pemindahan:baru" state={{ snapshot: { rows, requestKey, warehouseId }, reset: () => { setWarehouseId(""); setRows([{ ...blank }]); setRequestKey(crypto.randomUUID()); }, restore: (value) => { const draft = value as { rows?: Row[]; requestKey?: string; warehouseId?: string }; if (Array.isArray(draft.rows)) setRows(draft.rows); if (draft.requestKey) setRequestKey(draft.requestKey); if (typeof draft.warehouseId === "string") setWarehouseId(draft.warehouseId); return true; } }} />
      <input type="hidden" name="request_key" value={requestKey} />
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <input type="hidden" name="items" value={JSON.stringify(payload)} />


      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}>
        <div className="crm-sec" style={{ marginBottom: 0, minWidth: 0 }}>
          <SecHeader num="01" title="DETAIL PENGIRIMAN" desc="Gudang asal, tujuan, dan tanggal kirim." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang asal *</label>
            <select className="fi" name="from_warehouse_id" required ref={warehouseSelect} data-draft-state value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang tujuan *</label>
            <select className="fi" name="to_warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={3}
              placeholder="Keterangan tambahan (opsional)..." style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0, minWidth: 0 }}>
          <SecHeader num="02" title="RINCIAN BARANG" desc="Cari barang dari master SKU, isi kuantitas."
            action={
              <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah barang
              </button>
            } />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => {
              const it = byId.get(r.item_id);
              return (
                <div key={i}><div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}><SearchableItemPicker items={items} value={r.item_id}
                    ariaLabel={`Barang pemindahan ${i + 1}`} textValue={it && r.display === label(it) ? it.name : r.display}
                    onTextChange={text => onDisplay(i, text)} onChange={id => { const selected = byId.get(id); if (selected) set(i, { item_id: id, display: selected.name, satuan: selected.units[0]?.unit ?? "" }); }} /></div>
                  <NumberInput className="fi" type="number" min={0} step="any" value={r.qty}
                    onChange={(e) => set(i, { qty: Number(e.target.value) })}
                    style={{ width: 80 }} title="Kuantitas" />
                  <select className="fi" aria-label="Satuan barang" value={r.satuan} onChange={e => set(i, { satuan: e.target.value })} style={{ width: 90 }}>{(it?.units ?? []).map(u => <option key={u.unit} value={u.unit}>{u.unit}</option>)}</select>
                  <button type="button" onClick={() => del(i)} className="btn-def"
                    style={{ padding: "0 9px", color: "#b91c1c" }} title="Hapus">
                    <i className="ti ti-trash" />
                  </button>
                </div>
                  {it && <WarehouseStockHint warehouseId={warehouseId} quantity={stockByItem.get(it.id) ?? 0} baseUnit={it.unit} selectedUnit={it.units.find(u => u.unit === r.satuan)} />}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Ketik kode atau nama barang. Seluruh master barang persediaan tersedia; baris kosong diabaikan.
          </div>
        </div>
      </div>

      {kurang && (
        <div role="alert" className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginTop: 12 }}>
          <i className="ti ti-alert-circle" /> Stok gudang asal tidak cukup. {kurang}. Kurangi kuantitasnya.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <SubmitButton className="btn-acc" disabled={payload.length === 0 || kurang !== null} icon="ti-truck-delivery" pendingText="Menyimpan pemindahan…">
          Kirim barang
        </SubmitButton>
      </div>
    </form>
  );
}
