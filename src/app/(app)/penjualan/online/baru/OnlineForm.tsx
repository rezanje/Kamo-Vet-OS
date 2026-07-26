"use client";

// ponytail: baris item dinamis diserialisasi ke hidden JSON — pola sama dengan POForm.
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { CHANNELS } from "@/lib/online";
import { buatPenjualanOnline } from "../actions";

type Warehouse = { id: string; name: string; branch_name: string };
type Item = { id: string; code: string; name: string; sell_price: number };
type Customer = { id: string; name: string; phone: string | null };
type Row = { item_id: string; nama: string; qty: number; harga: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { item_id: "", nama: "", qty: 1, harga: 0 };
const itemLabel = (it: Item) => `${it.code} — ${it.name}`;
const custLabel = (c: Customer) => (c.phone ? `${c.name} (${c.phone})` : c.name);

export function OnlineForm({
  warehouses,
  items,
  customers,
}: {
  warehouses: Warehouse[];
  items: Item[];
  customers: Customer[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);
  const [channel, setChannel] = useState<string>("Shopee");
  const [custText, setCustText] = useState("");

  const byLabel = new Map(items.map((it) => [itemLabel(it), it]));
  const custByLabel = new Map(customers.map((c) => [custLabel(c), c]));
  const customerId = custByLabel.get(custText)?.id ?? "";

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Wajib pilih dari master SKU — stok & HPP FIFO butuh item_id (teks bebas ditolak server).
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v);
    set(i, it
      ? { nama: it.name, item_id: it.id, harga: Number(it.sell_price) || 0 }
      : { nama: v, item_id: "" });
  };
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={buatPenjualanOnline}>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <input type="hidden" name="customer_id" value={customerId} />
      <datalist id="onl-items">
        {items.map((it) => <option key={it.id} value={itemLabel(it)} />)}
      </datalist>
      <datalist id="onl-customers">
        {customers.map((c) => <option key={c.id} value={custLabel(c)} />)}
      </datalist>

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL ORDER" desc="Channel, gudang online & data pembeli." />

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Channel *</label>
            <select
              className="fi"
              name="channel"
              required
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c === "WA" ? "WA / Transfer Manual" : c}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang online *</label>
            <select className="fi" name="warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name} · {w.branch_name}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Nama pembeli</label>
            <input className="fi" name="buyer_name" placeholder="Nama pembeli di marketplace" />
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">No. order / referensi</label>
            <input className="fi" name="external_ref" placeholder="Contoh: 250726ABCDEFG" />
          </div>

          {channel === "WA" && (
            <div className="fg" style={{ marginBottom: 10 }}>
              <label className="flab">Link pelanggan (opsional)</label>
              <input
                className="fi"
                list="onl-customers"
                value={custText}
                onChange={(e) => setCustText(e.target.value)}
                placeholder="Cari nama / no HP pelanggan"
              />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Kalau dilink, order ini menambah poin &amp; tier pelanggan. Order marketplace tidak masuk CRM.
              </div>
            </div>
          )}

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal order</label>
            <input className="fi" type="date" name="tanggal" defaultValue={today} />
          </div>

          {total > 0 && (
            <div style={{
              marginTop: 14, padding: "10px 14px", background: "var(--bg2, #f9fafb)",
              borderRadius: 6, border: ".5px solid var(--bd)", fontSize: 13, fontWeight: 700,
              display: "flex", justifyContent: "space-between",
            }}>
              <span style={{ color: "var(--tm)", fontWeight: 500 }}>Total Order</span>
              <span>{rp(total)}</span>
            </div>
          )}
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader
            num="02"
            title="DAFTAR BARANG"
            desc="Pilih dari master SKU — stok gudang online otomatis berkurang."
            action={
              <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah baris
              </button>
            }
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="fi"
                  list="onl-items"
                  placeholder="Kode / nama barang"
                  defaultValue={r.nama}
                  onChange={(e) => setNama(i, e.target.value)}
                  style={{ flex: 2 }}
                />
                <input
                  className="fi" type="number" min={0} step="any" value={r.qty}
                  onChange={(e) => set(i, { qty: Number(e.target.value) })}
                  style={{ width: 70 }} title="Qty" placeholder="Qty"
                />
                <input
                  className="fi" type="number" min={0} step="any" value={r.harga}
                  onChange={(e) => set(i, { harga: Number(e.target.value) })}
                  style={{ width: 110 }} title="Harga jual" placeholder="Harga"
                />
                <button
                  type="button" onClick={() => del(i)} className="btn-def"
                  style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0 }} title="Hapus baris"
                >
                  <i className="ti ti-trash" />
                </button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Baris tanpa barang dari master SKU diabaikan (stok &amp; HPP butuh SKU terdaftar).
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <a href="/penjualan/online" className="btn-def" style={{ textDecoration: "none" }}>Batal</a>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan order
        </button>
      </div>
    </form>
  );
}
