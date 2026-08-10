"use client";

// ponytail: baris item dinamis diserialisasi ke hidden JSON — pola sama dengan POForm.
import Link from "next/link";
import { useMemo, useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { CHANNELS } from "@/lib/online";
import { buatPenjualanOnline } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

type Warehouse = { id: string; name: string; branch_name: string };
type Item = { id: string; code: string; name: string; sell_price: number };
type Customer = { id: string; name: string; phone: string | null };
// `nama` = nama bare yang diserialisasi ke server (kontrak actions.ts).
// `label` = teks yang tampil di input (bisa "CODE — Nama" hasil pilih datalist, atau teks bebas).
type Row = { item_id: string; nama: string; label: string; qty: number; harga: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { item_id: "", nama: "", label: "", qty: 1, harga: 0 };
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

  // 2000 item/pelanggan tiap render kalau dibangun ulang tiap keystroke — cukup saat items/customers berubah.
  const byLabel = useMemo(() => new Map(items.map((it) => [itemLabel(it), it])), [items]);
  const custByLabel = useMemo(() => new Map(customers.map((c) => [custLabel(c), c])), [customers]);
  const customerId = custByLabel.get(custText)?.id ?? "";

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Wajib pilih dari master SKU — stok & HPP FIFO butuh item_id (teks bebas ditolak server).
  // `label` (tampilan input) beda dari `nama` (bare, diserialisasi ke server): datalist
  // menampilkan "CODE — Nama" tapi server hanya mau nama bare (I1).
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v);
    set(i, it
      ? { nama: it.name, item_id: it.id, harga: Number(it.sell_price) || 0, label: itemLabel(it) }
      // Tak match SKU manapun — item_id kosong (baris ini akan di-drop saat submit), jadi harga
      // lama juga direset ke 0 supaya tak ada harga basi nempel di SKU yang sudah tak valid.
      : { nama: v, item_id: "", label: v, harga: 0 });
  };
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  // WIB (UTC+7), bukan UTC — samakan dengan todayJakarta() di actions.ts. Server Vercel
  // jalan di UTC; tanpa offset ini, order pagi WIB (00:00–07:00) prefill tanggal kemarin (I2).
  const today = hariIniWIB();
  // Baris tanpa item_id (kosong / teks bebas tak match SKU) di-drop sebelum kirim — server
  // menolak SELURUH submit kalau ada satu saja baris tanpa item_id (I3). Kalau hasilnya
  // nol baris, tetap kirim apa adanya (array kosong) supaya pesan server "Minimal 1 barang"
  // yang tampil, bukan submit senyap tanpa umpan balik.
  const itemsToSubmit = rows
    .filter((r) => r.item_id)
    .map(({ item_id, nama, qty, harga }) => ({ item_id, nama, qty, harga }));
  // Total dihitung dari itemsToSubmit (bukan seluruh rows) supaya preview selalu sama dengan
  // yang benar-benar tersimpan — baris tanpa item_id valid ikut di-drop dari total juga (I3).
  const total = itemsToSubmit.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);

  return (
    <form action={buatPenjualanOnline}>
      <input type="hidden" name="items" value={JSON.stringify(itemsToSubmit)} />
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
              onChange={(e) => {
                const v = e.target.value;
                setChannel(v);
                // Channel selain WA tidak boleh link pelanggan (invarian marketplace) — kosongkan
                // state supaya customer_id tersembunyi tidak diam-diam ikut submit (M5).
                if (v !== "WA") setCustText("");
              }}
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
            {rows.map((r, i) => {
              // Teks diisi tapi belum match SKU manapun — baris ini akan di-drop saat submit (I3),
              // beri tanda visual supaya operator sadar sebelum klik Simpan.
              const belumValid = !r.item_id && r.label.trim().length > 0;
              return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="fi"
                    list="onl-items"
                    placeholder="Kode / nama barang"
                    value={r.label}
                    onChange={(e) => setNama(i, e.target.value)}
                    style={belumValid ? { flex: 2, border: "1px solid #f59e0b" } : { flex: 2 }}
                  />
                  <input
                    className="fi" type="number" min={1} step={1} value={r.qty}
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
                {belumValid && (
                  <div style={{ fontSize: 9.5, color: "#f59e0b" }}>
                    Belum cocok dengan SKU manapun — baris ini tidak akan ikut tersimpan.
                  </div>
                )}
              </div>
              );
            })}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Baris tanpa barang dari master SKU otomatis dihapus saat disimpan (stok &amp; HPP butuh
            SKU terdaftar) — tidak perlu dihapus manual sebelum submit.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Link href="/penjualan/online" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan order
        </button>
      </div>
    </form>
  );
}
