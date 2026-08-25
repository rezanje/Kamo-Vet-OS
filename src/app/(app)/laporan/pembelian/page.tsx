import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";

// Pembelian per Pemasok & per Barang — permintaan Kamo Group 24 Agu 2026.
//
// Dasarnya FAKTUR pembelian, bukan pesanan atau penerimaan barang: faktur yang
// mengakui belanja dan melahirkan hutang. Pesanan bisa batal dan barang bisa datang
// tanpa faktur; keduanya belum jadi pembelian menurut pembukuan.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const num = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function LaporanPembelianPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";

  const supabase = await createClient();
  const [{ data: invData }, { data: retData }, { data: branchData }] = await Promise.all([
    supabase.from("purchase_invoices")
      .select("id, no_faktur, tanggal, total, branch_id, supplier_id, suppliers(nama), purchase_invoice_payments(amount), purchase_invoice_items(item_id, nama, qty, harga, faktor, items(unit, item_categories(name)))")
      .gte("tanggal", dari).lte("tanggal", sampai),
    supabase.from("purchase_returns")
      .select("total, tanggal, purchase_orders(supplier_id)")
      .gte("tanggal", dari).lte("tanggal", sampai),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  type Item = {
    item_id: string | null; nama: string; qty: number; harga: number; faktor: number | null;
    items: Rel<{ unit: string | null; item_categories: Rel<{ name: string }> }>;
  };
  type Inv = {
    id: string; no_faktur: string; tanggal: string; total: number;
    branch_id: string | null; supplier_id: string | null; suppliers: Rel<{ nama: string }>;
    purchase_invoice_payments: { amount: number }[] | null;
    purchase_invoice_items: Item[] | null;
  };

  const invoices = ((invData ?? []) as unknown as Inv[]).filter((v) => !cabang || v.branch_id === cabang);

  // ── Per pemasok ────────────────────────────────────────────────────────────
  type Pemasok = { nama: string; faktur: number; nilai: number; dibayar: number; retur: number };
  const perPemasok = new Map<string, Pemasok>();
  for (const v of invoices) {
    const kunci = v.supplier_id ?? "—";
    const row = perPemasok.get(kunci) ?? {
      nama: one(v.suppliers)?.nama ?? "(tanpa pemasok)", faktur: 0, nilai: 0, dibayar: 0, retur: 0,
    };
    row.faktur++;
    row.nilai += Number(v.total) || 0;
    row.dibayar += (v.purchase_invoice_payments ?? []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    perPemasok.set(kunci, row);
  }

  type Ret = { total: number; purchase_orders: Rel<{ supplier_id: string | null }> };
  for (const r of (retData ?? []) as unknown as Ret[]) {
    const kunci = one(r.purchase_orders)?.supplier_id ?? "—";
    const row = perPemasok.get(kunci);
    // Retur ke pemasok yang tidak punya faktur di rentang ini tidak dibuatkan baris
    // sendiri — barisnya akan terbaca seperti pembelian nol dengan retur menggantung.
    if (row) row.retur += Number(r.total) || 0;
  }

  const pemasokRows = [...perPemasok.values()]
    .map((r) => ({ ...r, bersih: r.nilai - r.retur, sisa: Math.max(0, r.nilai - r.dibayar - r.retur) }))
    .sort((a, b) => b.bersih - a.bersih);

  // ── Per barang ─────────────────────────────────────────────────────────────
  type Barang = { nama: string; kategori: string; satuan: string; qty: number; nilai: number; pemasok: Set<string>; faktur: Set<string> };
  const perBarang = new Map<string, Barang>();
  for (const v of invoices) {
    for (const it of v.purchase_invoice_items ?? []) {
      const kunci = it.item_id ?? `nama:${it.nama}`;
      const master = one(it.items);
      const row = perBarang.get(kunci) ?? {
        nama: it.nama,
        kategori: one(master?.item_categories ?? null)?.name ?? "(tanpa kategori)",
        satuan: master?.unit ?? "unit",
        qty: 0, nilai: 0, pemasok: new Set<string>(), faktur: new Set<string>(),
      };
      // Qty disamakan ke satuan dasar: beli 1 dus isi 12 = 12 pcs, supaya barang yang
      // kadang dibeli per dus dan kadang per pcs tidak dijumlah sebagai angka campuran.
      row.qty += (Number(it.qty) || 0) * (Number(it.faktor) || 1);
      row.nilai += (Number(it.qty) || 0) * (Number(it.harga) || 0);
      if (v.supplier_id) row.pemasok.add(v.supplier_id);
      row.faktur.add(v.id);
      perBarang.set(kunci, row);
    }
  }
  const barangRows = [...perBarang.values()]
    .map((r) => ({ ...r, rataHarga: r.qty ? r.nilai / r.qty : 0 }))
    .sort((a, b) => b.nilai - a.nilai);

  const totalNilai = pemasokRows.reduce((a, r) => a + r.nilai, 0);
  const totalRetur = pemasokRows.reduce((a, r) => a + r.retur, 0);
  const totalDibayar = pemasokRows.reduce((a, r) => a + r.dibayar, 0);
  const totalSisa = pemasokRows.reduce((a, r) => a + r.sisa, 0);

  return (
    <LaporanPage
      icon="ti-truck-delivery" title="PEMBELIAN PER PEMASOK & BARANG"
      desc="Belanja ke siapa, belanja apa, berapa banyak, dan berapa yang belum dibayar."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(branchData ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Pemasok", nilai: `${pemasokRows.length} pemasok` },
          { label: "Faktur pembelian", nilai: `${invoices.length} faktur` },
          { label: "Nilai pembelian", nilai: rp(totalNilai) },
          { label: "Retur", nilai: totalRetur ? `− ${rp(totalRetur)}` : "—", warna: totalRetur ? "#b45309" : undefined },
          { label: "Sudah dibayar", nilai: rp(totalDibayar), warna: "#15803d" },
          { label: "Belum dibayar", nilai: rp(totalSisa), warna: totalSisa ? "#b91c1c" : "#15803d" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · PEMBELIAN PER PEMASOK</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Pemasok</th>
                <th style={{ width: 80, textAlign: "center" }}>Faktur</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai pembelian</th>
                <th style={{ width: 110, textAlign: "right" }}>Retur</th>
                <th style={{ width: 140, textAlign: "right" }}>Pembelian bersih</th>
                <th style={{ width: 130, textAlign: "right" }}>Sudah dibayar</th>
                <th style={{ width: 130, textAlign: "right" }}>Belum dibayar</th>
              </tr>
            </thead>
            <tbody>
              {pemasokRows.map((r) => (
                <tr key={r.nama}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.faktur}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.nilai)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.retur ? "#b45309" : "var(--td)" }}>
                    {r.retur ? `− ${rp(r.retur)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.bersih)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "#15803d" }}>{r.dibayar ? rp(r.dibayar) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: r.sisa ? "#b91c1c" : "var(--td)" }}>
                    {r.sisa ? rp(r.sisa) : "lunas"}
                  </td>
                </tr>
              ))}
              {pemasokRows.length === 0 && <TabelKosong kolom={7} pesan="Belum ada faktur pembelian di rentang ini." />}
            </tbody>
            {pemasokRows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ fontSize: 11.5 }}>TOTAL</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{invoices.length}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalNilai)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{totalRetur ? `− ${rp(totalRetur)}` : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalNilai - totalRetur)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalDibayar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalSisa)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Uang muka pembelian tidak dihitung sebagai pembelian di sini — dia baru jadi pembelian
          saat fakturnya terbit. Kolom &quot;belum dibayar&quot; adalah posisi hari ini, bukan posisi
          di tanggal akhir rentang.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · PEMBELIAN PER BARANG</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ width: 150 }}>Kategori</th>
                <th style={{ width: 120, textAlign: "right" }}>Jumlah dibeli</th>
                <th style={{ width: 130, textAlign: "right" }}>Harga rata-rata</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai</th>
                <th style={{ width: 80, textAlign: "center" }}>Pemasok</th>
                <th style={{ width: 70, textAlign: "center" }}>Faktur</th>
              </tr>
            </thead>
            <tbody>
              {barangRows.map((r) => (
                <tr key={r.nama}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.kategori}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{num(r.qty)} {r.satuan}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.rataHarga)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.nilai)}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.pemasok.size || "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.faktur.size}</td>
                </tr>
              ))}
              {barangRows.length === 0 && <TabelKosong kolom={7} pesan="Belum ada baris barang di faktur pembelian rentang ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Jumlah disamakan ke satuan dasar: beli 1 dus isi 12 dihitung 12 pcs, jadi barang yang
          kadang dibeli per dus dan kadang per pcs tidak dijumlah sebagai angka campuran.
          &quot;Harga rata-rata&quot; adalah nilai dibagi jumlah dasar — berguna melihat harga beli
          yang merangkak naik. Kolom pemasok menunjukkan berapa pemasok berbeda menjual barang
          yang sama; angka lebih dari satu berarti ada pembanding harga.
        </div>
      </div>
    </LaporanPage>
  );
}
