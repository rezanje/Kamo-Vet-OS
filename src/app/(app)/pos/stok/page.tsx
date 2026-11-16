import { readListPage, TABLE_PAGE_SIZE } from "@/lib/checked-list";
import { infoHalaman } from "@/lib/pagination";
import { ListPagination, ListLoadFailure } from "@/components/ListPagination";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ResetSimulasiForm } from "./ResetSimulasiForm";
import { GudangSelect } from "./GudangSelect";
import { polaCariStok } from "@/lib/stok-cari";
import { bacaGudangAktif, bacaMatrixStok, type GudangStok, type MatrixStok } from "@/lib/stok-gudang-server";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Item = { id: string; code: string; name: string; unit: string | null };
type StockRow = { id: string; qty: number; items: Rel<Item> };

export default async function StokPage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string; error?: string; success?: string; hal?: string; q?: string }>;
}) {
  const { wh, error, success, hal, q } = await searchParams;
  const cari = (q ?? "").trim();
  const pola = polaCariStok(cari);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };

  let warehouses: GudangStok[];
  try {
    warehouses = await bacaGudangAktif(supabase);
  } catch (error) { return <ListLoadFailure error={error} label="Daftar gudang" />; }

  // "all" = matrix semua gudang (ala laporan Persediaan per Gudang Accurate).
  const matrixMode = wh === "all";
  // gudang terpilih dari ?wh (filter Link-based), fallback ke yang pertama.
  const selectedWh = matrixMode ? null : warehouses.find((w) => w.id === wh) ?? warehouses[0] ?? null;

  let matrix: MatrixStok | null = null;
  if (matrixMode) {
    try {
      matrix = await bacaMatrixStok(supabase, cari);
    } catch (error) { return <ListLoadFailure error={error} label="Stok semua gudang" />; }
  }

  let stock: StockRow[] = [];
  let stockCount = 0;
  let pageInfo = infoHalaman(hal, matrix?.items.length ?? 0, TABLE_PAGE_SIZE);
  if (selectedWh) {
    try {
      const result = await readListPage<StockRow>(async (from, to) => {
        let query = supabase.from("stock")
          .select(pola ? "id, qty, items!inner(id, code, name, unit)" : "id, qty, items(id, code, name, unit)", { count: "exact" })
          .eq("warehouse_id", selectedWh.id);
        if (pola) query = query.or(`name.ilike.${pola},code.ilike.${pola}`, { referencedTable: "items" });
        const response = await query.order("updated_at", { ascending: false }).order("id").range(from, to);
        return { ...response, data: response.data as unknown as StockRow[] | null };
      }, "Stok gudang", hal);
      stock = result.rows;
      stockCount = result.count;
      pageInfo = result.pageInfo;
    } catch (error) { return <ListLoadFailure error={error} label="Stok gudang" />; }
  }

  // Unduhan memuat SEMUA barang sesuai saringan, bukan hanya halaman yang tampil.
  const whUnduh = matrixMode ? "all" : selectedWh?.id;
  const unduh = (format: "xlsx" | "csv") =>
    `/pos/stok/unduh?${new URLSearchParams({ wh: whUnduh ?? "", ...(cari ? { q: cari } : {}), format })}`;
  const tombolUnduh = whUnduh ? (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "var(--tm)" }}>Unduh semua barang{cari ? " yang cocok" : ""}:</span>
      <a className="btn-def" style={{ fontSize: 11 }} href={unduh("xlsx")}><i className="ti ti-file-spreadsheet" /> Excel</a>
      <a className="btn-def" style={{ fontSize: 11 }} href={unduh("csv")}><i className="ti ti-download" /> CSV</a>
    </div>
  ) : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Stok per Gudang</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success === "1" ? "Stok berhasil ditambahkan." : success}</div>}

      {/* pilih gudang (dropdown) + cari barang: satu form GET */}
      <div className="crm-sec" style={{ paddingBottom: 12 }}>
        {warehouses.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--td)" }}>Belum ada gudang aktif.</span>
        ) : (
          <form method="get" role="search" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <GudangSelect
              value={matrixMode ? "all" : selectedWh?.id ?? ""}
              options={[{ id: "all", label: "Semua gudang (matrix)" }, ...warehouses.map((w) => ({ id: w.id, label: `${w.name} · ${w.code}` }))]}
            />
            <input className="fi" type="search" name="q" defaultValue={cari} aria-label="Cari barang"
              placeholder="Cari kode atau nama barang…" style={{ flex: "1 1 220px", minWidth: 0 }} autoFocus={!!cari} />
            <button type="submit" className="btn-acc" style={{ fontSize: 11 }}><i className="ti ti-search" /> Tampilkan</button>
            {cari && <Link href={`/pos/stok?wh=${matrixMode ? "all" : selectedWh?.id ?? ""}`} className="btn-def" style={{ fontSize: 11 }}>Reset</Link>}
            {cari && <span style={{ fontSize: 11, color: "var(--tm)" }}>
              {(matrixMode ? matrix?.items.length ?? 0 : stockCount).toLocaleString("id-ID")} barang cocok dengan “{cari}”
            </span>}
          </form>
        )}
      </div>

      {matrixMode && matrix && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="RINGKASAN PERSEDIAAN PER GUDANG"
            desc={`${matrix.items.length} barang × ${matrix.gudang.length} gudang (ala laporan Accurate). Geser ke samping untuk semua gudang — kode & nama barang tetap di tempat.`}
          />
          {tombolUnduh}
          <div style={{ overflowX: "auto" }}>
            <table className="tbl stok-matrix" style={{ minWidth: 520 + matrix.gudang.length * 72 }}>
              <thead>
                <tr>
                  <th className="sm-kode">Kode</th>
                  <th className="sm-nama">Nama</th>
                  {matrix.gudang.map((g) => (
                    <th key={g} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{g}</th>
                  ))}
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.items.slice(pageInfo.from, pageInfo.to + 1).map((r) => (
                  <tr key={r.item_id}>
                    <td className="sm-kode" style={{ fontSize: 11, fontFamily: "var(--mono, monospace)" }}>{r.code}</td>
                    <td className="sm-nama" style={{ fontSize: 11 }}>{r.name}</td>
                    {matrix!.gudang.map((g) => (
                      <td key={g} style={{ textAlign: "right", fontSize: 11, color: r.per[g] ? undefined : "var(--td)" }}>
                        {r.per[g] ? Number(r.per[g]).toLocaleString("id-ID") : "·"}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{r.total.toLocaleString("id-ID")}</td>
                  </tr>
                ))}
                {matrix.items.length === 0 && (
                  <tr><td colSpan={3 + matrix.gudang.length} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>{cari ? `Tidak ada barang yang cocok dengan “${cari}”.` : "Belum ada stok tercatat."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <ListPagination path="/pos/stok" query={cari ? { wh: "all", q: cari } : { wh: "all" }} total={matrix.items.length} pageInfo={pageInfo} />
        </div>
      )}

      {!matrixMode && (
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="STOK GUDANG"
          desc={selectedWh ? `${selectedWh.name} · ${selectedWh.code}` : "Pilih gudang dulu"}
        />
        {selectedWh && tombolUnduh}
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
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>{cari ? `Tidak ada barang yang cocok dengan “${cari}” di gudang ini.` : "Belum ada stok di gudang ini. Stok akan bertambah lewat penerimaan pembelian, pemindahan masuk, atau penyesuaian stok."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {selectedWh && <ListPagination path="/pos/stok" query={cari ? { wh: selectedWh.id, q: cari } : { wh: selectedWh.id }} total={stockCount} pageInfo={pageInfo} />}
      </div>
      )}

      {!matrixMode && (
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="KOREKSI STOK"
          desc="Perubahan stok di luar penjualan & penerimaan dilakukan lewat dokumen Penyesuaian Persediaan."
        />
        {/* Form koreksi cepat di layar ini dihapus (S2). Angkanya memang berubah
            dan jurnalnya benar, tapi tidak meninggalkan dokumen: tidak bernomor,
            alasannya boleh kosong, dan tidak ada layar yang bisa menjawab "bulan
            ini berapa barang hilang". Satu pintu, dan pintunya bernomor. */}
        <div style={{ fontSize: 11.5, color: "var(--tm)", lineHeight: 1.6, marginBottom: 10 }}>
          Dokumennya bernomor, alasannya wajib diisi (rusak · hilang · kadaluarsa · temuan),
          dan tiap barang tersimpan lengkap dengan stok sistem sebelum diubah — jadi koreksinya
          bisa ditelusuri lagi berbulan-bulan kemudian.
        </div>
        <Link href={selectedWh ? `/pos/penyesuaian/baru?wh=${selectedWh.id}` : "/pos/penyesuaian/baru"}
          className="btn-acc" style={{ fontSize: 11.5, textDecoration: "none" }}>
          <i className="ti ti-adjustments-alt" /> Buat penyesuaian
        </Link>
        <Link href="/pos/penyesuaian" className="btn-def"
          style={{ fontSize: 11.5, textDecoration: "none", marginLeft: 8 }}>
          Lihat riwayat penyesuaian
        </Link>
      </div>
      )}

      <ResetSimulasiForm role={profile?.role} />

    </>
  );
}
