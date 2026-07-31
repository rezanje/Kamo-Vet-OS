import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { hitungUsulan, perluDipesan, kelompokPemasok, type BarangReorder } from "@/lib/reorder";
import { buatPOdariUsulan } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

type ItemRow = {
  id: string; code: string; name: string; unit: string; min_stock: number;
  buy_price: number; buy_unit: string | null; min_buy: number;
  supplier_id: string | null; suppliers: Rel<{ nama: string }>;
};

export default async function StokMinimumPage({
  searchParams,
}: {
  searchParams: Promise<{ gudang?: string; error?: string }>;
}) {
  const { gudang = "", error } = await searchParams;
  const supabase = await createClient();

  const [{ data: whRows }, { data: itemRows }] = await Promise.all([
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    supabase
      .from("items")
      .select("id, code, name, unit, min_stock, buy_price, buy_unit, min_buy, supplier_id, suppliers(nama)")
      .eq("item_type", "Persediaan").eq("is_active", true).gt("min_stock", 0).order("name"),
  ]);
  const gudangs = (whRows ?? []) as { id: string; code: string; name: string }[];
  const items = (itemRows ?? []) as unknown as ItemRow[];
  const gudangId = gudangs.some((w) => w.id === gudang) ? gudang : "";

  // Stok dibanding batas minimum. Tanpa filter gudang = stok seluruh gudang
  // digabung; kalau gudang dipilih, batas minimum berlaku untuk gudang itu saja.
  const ids = items.map((i) => i.id);
  let stokQ = supabase.from("stock").select("item_id, qty");
  if (ids.length) stokQ = stokQ.in("item_id", ids);
  if (gudangId) stokQ = stokQ.eq("warehouse_id", gudangId);
  const { data: stokRows } = ids.length ? await stokQ : { data: [] };
  const stok = new Map<string, number>();
  for (const s of (stokRows ?? []) as { item_id: string; qty: number }[]) {
    stok.set(s.item_id, (stok.get(s.item_id) ?? 0) + Number(s.qty));
  }

  const unitMap = await loadItemUnits(supabase, ids);

  const menipis: BarangReorder[] = items
    .map((i) => {
      const opts = unitOptions({ unit: i.unit, sell_price: 0, buy_price: Number(i.buy_price) }, unitMap.get(i.id) ?? []);
      const beli = opts.find((u) => u.unit === (i.buy_unit ?? i.unit)) ?? opts[0];
      return {
        itemId: i.id, kode: i.code, nama: i.name, satuan: i.unit,
        stok: stok.get(i.id) ?? 0, minStock: Number(i.min_stock),
        minBuy: Number(i.min_buy), buyUnit: beli.unit, faktorBeli: beli.factor,
        hargaBeli: Number(beli.buy_price) || Number(i.buy_price) || 0,
        supplierId: i.supplier_id, supplierNama: one(i.suppliers)?.nama ?? "Belum ada pemasok",
      };
    })
    .filter(perluDipesan);

  const usulan = menipis.map(hitungUsulan);
  const grup = kelompokPemasok(usulan);
  const totalNilai = usulan.reduce((a, u) => a + u.nilai, 0);
  const kosong = usulan.filter((u) => u.stok <= 0).length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Barang Stok Minimum</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 240 }}>
            <label className="flab">Hitung stok di</label>
            <select className="fi" name="gudang" defaultValue={gudangId}>
              <option value="">Semua gudang digabung</option>
              {gudangs.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <SubmitButton className="btn-def" icon="ti-refresh" pendingText="Memuat…">Tampilkan</SubmitButton>
        </div>
      </form>

      <div className="crm-sec" style={{ marginBottom: 12, display: "flex", gap: 22, flexWrap: "wrap" }}>
        <Angka label="Perlu dipesan" nilai={`${usulan.length} barang`} />
        <Angka label="Sudah kosong" nilai={`${kosong} barang`} warna={kosong ? "#b91c1c" : undefined} />
        <Angka label="Perkiraan nilai pesanan" nilai={rp(totalNilai)} />
      </div>

      {usulan.length === 0 ? (
        <div className="crm-sec" style={{ textAlign: "center", color: "var(--td)", fontSize: 11, padding: "26px 0" }}>
          Tidak ada barang di bawah batas minimum.
          {" "}Batas minimum diisi di <Link href="/pos/sku" style={{ color: "#2563eb" }}>Barang &amp; Jasa</Link>.
        </div>
      ) : (
        <form action={buatPOdariUsulan}>
          <div className="crm-sec" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <label className="flab">Gudang tujuan pesanan *</label>
                <select className="fi" name="warehouse_id" defaultValue={gudangId} required>
                  <option value="">— pilih gudang —</option>
                  {gudangs.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </div>
              <SubmitButton className="btn-acc" icon="ti-file-plus" pendingText="Membuat…" style={{ background: "#2563eb" }}>
                Buat draft PO
              </SubmitButton>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6 }}>
              Satu draft PO per pemasok. Statusnya <b>Draft</b> — cek dulu di Pesanan Pembelian sebelum dikirim ke pemasok.
            </div>
          </div>

          {grup.map((g) => (
            <div className="crm-sec" key={g.supplierId ?? "tanpa"} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  <i className="ti ti-building-store" /> {g.supplierNama}
                  <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--tm)" }}> · {g.rows.length} barang</span>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}>{rp(g.nilai)}</div>
              </div>

              {!g.supplierId && (
                <div style={{ fontSize: 9.5, color: "#b45309", marginBottom: 7 }}>
                  <i className="ti ti-alert-triangle" /> Barang ini belum punya pemasok utama — PO-nya jadi tanpa pemasok.
                  Isi pemasoknya di master barang biar tidak perlu dibetulkan manual tiap kali.
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                <table className="tbl" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}></th>
                      <th style={{ width: 88 }}>Kode</th>
                      <th>Barang</th>
                      <th style={{ width: 90, textAlign: "right" }}>Stok</th>
                      <th style={{ width: 90, textAlign: "right" }}>Minimum</th>
                      <th style={{ width: 110, textAlign: "right" }}>Usul pesan</th>
                      <th style={{ width: 110, textAlign: "right" }}>Perkiraan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.itemId}>
                        <td>
                          <input type="checkbox" name="pilih" defaultChecked
                            value={`${r.itemId}|${r.supplierId ?? ""}|${r.qtyPesan}`} />
                        </td>
                        <td style={{ fontSize: 10.5, fontFamily: "var(--mono, monospace)", color: "var(--tm)" }}>{r.kode}</td>
                        <td style={{ fontSize: 11 }}>{r.nama}</td>
                        <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: r.stok <= 0 ? "#b91c1c" : undefined }}>
                          {r.stok.toLocaleString("id-ID")} <span style={{ fontSize: 9, color: "var(--td)" }}>{r.satuan}</span>
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                          {r.minStock.toLocaleString("id-ID")}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>
                          {r.qtyPesan.toLocaleString("id-ID")} <span style={{ fontSize: 9, fontWeight: 400, color: "var(--td)" }}>{r.buyUnit}</span>
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.nilai)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </form>
      )}
    </>
  );
}

function Angka({ label, nilai, warna }: { label: string; nilai: string; warna?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: warna }}>{nilai}</div>
    </div>
  );
}
