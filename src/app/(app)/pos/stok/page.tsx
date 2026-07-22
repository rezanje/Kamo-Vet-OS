import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { pivotStokPerGudang, type StokBaris } from "@/lib/laporan";
import { tambahStok } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Warehouse = { id: string; code: string; name: string; type: string };
type Item = { id: string; code: string; name: string; unit: string | null };
type StockRow = { id: string; qty: number; items: Rel<Item> };

export default async function StokPage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string; error?: string; success?: string }>;
}) {
  const { wh, error, success } = await searchParams;
  const supabase = await createClient();

  const { data: warehousesRaw } = await supabase
    .from("warehouses")
    .select("id, code, name, type")
    .eq("is_active", true)
    .order("name");
  const warehouses = (warehousesRaw ?? []) as unknown as Warehouse[];

  // "all" = matrix semua gudang (ala laporan Persediaan per Gudang Accurate).
  const matrixMode = wh === "all";
  // gudang terpilih dari ?wh (filter Link-based), fallback ke yang pertama.
  const selectedWh = matrixMode ? null : warehouses.find((w) => w.id === wh) ?? warehouses[0] ?? null;

  let matrix: ReturnType<typeof pivotStokPerGudang> | null = null;
  if (matrixMode) {
    const { data: allStock } = await supabase
      .from("stock")
      .select("item_id, qty, warehouses(code), items(id, code, name, unit)");
    const rows: StokBaris[] = ((allStock ?? []) as unknown as { item_id: string; qty: number; warehouses: Rel<{ code: string }>; items: Rel<Item> }[])
      .map((s) => {
        const it = one(s.items);
        return {
          item_id: s.item_id,
          code: it?.code ?? "—",
          name: it?.name ?? "—",
          unit: it?.unit ?? "",
          wh_code: one(s.warehouses)?.code ?? "?",
          qty: Number(s.qty),
        };
      });
    matrix = pivotStokPerGudang(rows);
  }

  let stock: StockRow[] = [];
  let items: Item[] = [];
  if (selectedWh) {
    const { data: stockRaw } = await supabase
      .from("stock")
      .select("id, qty, items(id, code, name, unit)")
      .eq("warehouse_id", selectedWh.id)
      .order("updated_at", { ascending: false });
    stock = (stockRaw ?? []) as unknown as StockRow[];

    const { data: itemsRaw } = await supabase
      .from("items")
      .select("id, code, name, unit")
      .eq("is_active", true)
      .order("name");
    items = (itemsRaw ?? []) as unknown as Item[];
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Stok per Gudang</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "1" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Stok berhasil ditambahkan.</div>}

      {/* pilih gudang: chip Link, ?wh=id */}
      <div className="crm-sec" style={{ paddingBottom: 12 }}>
        <div style={{ fontSize: 10, color: "var(--tm)", marginBottom: 8 }}>Pilih gudang</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {warehouses.length === 0 && <span style={{ fontSize: 11, color: "var(--td)" }}>Belum ada gudang aktif.</span>}
          {warehouses.length > 0 && (
            <Link href="/pos/stok?wh=all" className={matrixMode ? "btn-acc" : "btn-def"} style={{ fontSize: 11 }}>
              <i className="ti ti-table" /> Semua gudang (matrix)
            </Link>
          )}
          {warehouses.map((w) => {
            const active = selectedWh?.id === w.id;
            return (
              <Link
                key={w.id}
                href={`/pos/stok?wh=${w.id}`}
                className={active ? "btn-acc" : "btn-def"}
                style={{ fontSize: 11 }}
              >
                <i className="ti ti-building-warehouse" /> {w.name}
              </Link>
            );
          })}
        </div>
      </div>

      {matrixMode && matrix && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="RINGKASAN PERSEDIAAN PER GUDANG"
            desc={`${matrix.items.length} barang × ${matrix.gudang.length} gudang (ala laporan Accurate). Geser ke samping untuk semua gudang.`}
          />
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 520 + matrix.gudang.length * 72 }}>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  {matrix.gudang.map((g) => (
                    <th key={g} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{g}</th>
                  ))}
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.items.map((r) => (
                  <tr key={r.item_id}>
                    <td style={{ fontSize: 11, fontFamily: "var(--mono, monospace)" }}>{r.code}</td>
                    <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{r.name}</td>
                    {matrix!.gudang.map((g) => (
                      <td key={g} style={{ textAlign: "right", fontSize: 11, color: r.per[g] ? undefined : "var(--td)" }}>
                        {r.per[g] ? Number(r.per[g]).toLocaleString("id-ID") : "·"}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{r.total.toLocaleString("id-ID")}</td>
                  </tr>
                ))}
                {matrix.items.length === 0 && (
                  <tr><td colSpan={3 + matrix.gudang.length} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada stok tercatat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!matrixMode && (
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="STOK GUDANG"
          desc={selectedWh ? `${selectedWh.name} · ${selectedWh.code}` : "Pilih gudang dulu"}
        />
        {!selectedWh ? (
          <div style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada gudang aktif untuk ditampilkan.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>Kode</th><th>Nama</th><th>Satuan</th><th style={{ textAlign: "right" }}>Qty</th></tr>
              </thead>
              <tbody>
                {stock.map((s) => {
                  const it = one(s.items);
                  return (
                    <tr key={s.id}>
                      <td style={{ fontSize: 11, fontFamily: "var(--mono, monospace)" }}>{it?.code ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{it?.name ?? "—"}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{it?.unit ?? "—"}</td>
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{Number(s.qty).toLocaleString("id-ID")}</td>
                    </tr>
                  );
                })}
                {stock.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada stok di gudang ini. Tambahkan lewat Stok Masuk di bawah.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {!matrixMode && (
      <div className="crm-sec">
        <SecHeader num="02" title="STOK MASUK (penyesuaian)" desc="Tambah qty ke stok gudang terpilih." />
        {!selectedWh ? (
          <div style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Pilih gudang dulu untuk menambah stok.</div>
        ) : (
          <form action={tambahStok} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="warehouseId" value={selectedWh.id} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <label className="flab">Item *</label>
              <select className="fi" name="itemId" required>
                <option value="">Pilih item</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>{it.code} — {it.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, maxWidth: 160 }}>
              <label className="flab">Qty masuk *</label>
              <input className="fi" name="qty" type="number" step="any" placeholder="0" required />
            </div>
            <div style={{ minWidth: 160 }}>
              <label className="flab">Gudang</label>
              <input className="fi" value={selectedWh.name} disabled readOnly />
            </div>
            <button type="submit" className="btn-acc"><i className="ti ti-plus" /> Tambah Stok</button>
          </form>
        )}
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>Qty ditambahkan ke stok yang ada (akumulatif). Gunakan nilai negatif untuk koreksi/pengurangan.</div>
      </div>
      )}
    </>
  );
}
