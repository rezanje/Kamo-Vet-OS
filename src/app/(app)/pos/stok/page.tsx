import { readListPage, TABLE_PAGE_SIZE } from "@/lib/checked-list";
import { infoHalaman } from "@/lib/pagination";
import { ListPagination, ListLoadFailure } from "@/components/ListPagination";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ResetSimulasiForm } from "./ResetSimulasiForm";
import { GudangSelect } from "./GudangSelect";
import { polaCariStok, type RingkasCariStok } from "@/lib/stok-cari";
import { bacaGudangAktif, bacaMatrixStok, cariStokGudang, type BarisStokGudang, type GudangStok, type MatrixStok } from "@/lib/stok-gudang-server";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Item = { id: string; code: string; name: string; unit: string | null };
type StockRow = { id: string; qty: number; items: Rel<Item> };

export default async function StokPage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string; error?: string; success?: string; hal?: string; q?: string; semua?: string }>;
}) {
  const { wh, error, success, hal, q, semua: semuaParam } = await searchParams;
  const cari = (q ?? "").trim();
  const pola = polaCariStok(cari);
  // "semua=1": barang yang hanya memuat kata pencarian di TENGAH kata/kode ikut tampil.
  const semua = !!pola && semuaParam === "1";
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
      matrix = await bacaMatrixStok(supabase, cari, semua);
    } catch (error) { return <ListLoadFailure error={error} label="Stok semua gudang" />; }
  }

  let stock: BarisStokGudang[] = [];
  let stockCount = 0;
  let ringkasCari: RingkasCariStok | null = matrix?.ringkasCari ?? null;
  let pageInfo = infoHalaman(hal, matrix?.items.length ?? 0, TABLE_PAGE_SIZE);
  if (selectedWh) {
    try {
      if (pola) {
        // Ada pencarian: semua barang yang cocok dimuat lalu diurutkan (paling pas
        // di atas) di server, baru dipotong per halaman — sama dengan mode matrix.
        const hasil = await cariStokGudang(supabase, selectedWh.id, cari, semua);
        ringkasCari = hasil.ringkas;
        stockCount = hasil.baris.length;
        pageInfo = infoHalaman(hal, stockCount, TABLE_PAGE_SIZE);
        stock = hasil.baris.slice(pageInfo.from, pageInfo.to + 1);
      } else {
        const result = await readListPage<StockRow>(async (from, to) => {
          const response = await supabase.from("stock")
            .select("id, qty, items(id, code, name, unit)", { count: "exact" })
            .eq("warehouse_id", selectedWh.id)
            .order("updated_at", { ascending: false }).order("id").range(from, to);
          return { ...response, data: response.data as unknown as StockRow[] | null };
        }, "Stok gudang", hal);
        stock = result.rows.map((s) => {
          const it = one(s.items);
          return { id: s.id, code: it?.code ?? "—", name: it?.name ?? "—", unit: it?.unit ?? "", qty: Number(s.qty) };
        });
        stockCount = result.count;
        pageInfo = result.pageInfo;
      }
    } catch (error) { return <ListLoadFailure error={error} label="Stok gudang" />; }
  }

  // Saringan aktif, dibawa oleh tautan halaman, unduhan, dan tombol "tampilkan juga".
  const whAktif = matrixMode ? "all" : selectedWh?.id ?? "";
  const saringan = (denganSemua: boolean): Record<string, string> =>
    ({ wh: whAktif, ...(cari ? { q: cari } : {}), ...(denganSemua ? { semua: "1" } : {}) });
  const jumlahCocok = matrixMode ? matrix?.items.length ?? 0 : stockCount;

  // Unduhan memuat SEMUA barang sesuai saringan, bukan hanya halaman yang tampil.
  const whUnduh = matrixMode ? "all" : selectedWh?.id;
  const unduh = (format: "xlsx" | "csv") =>
    `/pos/stok/unduh?${new URLSearchParams({ ...saringan(semua), wh: whUnduh ?? "", format })}`;
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
            {semua && <input type="hidden" name="semua" value="1" />}
            {cari && <Link href={`/pos/stok?wh=${whAktif}`} className="btn-def" style={{ fontSize: 11 }}>Reset</Link>}
            {cari && <span style={{ fontSize: 11, color: "var(--tm)" }}>
              {jumlahCocok.toLocaleString("id-ID")} barang cocok dengan “{cari}”
            </span>}
          </form>
        )}
        {/* Yang tampil = barang yang nama/kodenya DIAWALI kata pencarian. Barang yang
            hanya memuatnya di tengah kata/kode ("RC" di "Curcuma" / kode "DRC…")
            disembunyikan, tapi selalu bisa dimunculkan dari sini. */}
        {ringkasCari && ringkasCari.longgar > 0 && ringkasCari.pas > 0 && (
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>
            {ringkasCari.tampilLonggar ? (
              <>Termasuk {ringkasCari.longgar.toLocaleString("id-ID")} barang yang hanya memuat “{cari}” di tengah nama/kode (ditaruh paling bawah).{" "}
                <Link href={`/pos/stok?${new URLSearchParams(saringan(false))}`}>Tampilkan yang paling cocok saja</Link></>
            ) : (
              <>Yang tampil: nama atau kodenya diawali “{cari}”. Ada {ringkasCari.longgar.toLocaleString("id-ID")} barang lain yang hanya memuat “{cari}” di tengah nama/kode.{" "}
                <Link href={`/pos/stok?${new URLSearchParams(saringan(true))}`}>Tampilkan juga</Link></>
            )}
          </div>
        )}
        {ringkasCari && ringkasCari.pas === 0 && ringkasCari.longgar > 0 && (
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>
            Tidak ada nama/kode yang diawali “{cari}” — yang tampil adalah barang yang memuatnya di tengah nama/kode.
          </div>
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
          <ListPagination path="/pos/stok" query={saringan(semua)} total={matrix.items.length} pageInfo={pageInfo} />
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
                {stock.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontSize: 11, fontFamily: "var(--mono, monospace)" }}>{s.code}</td>
                    <td style={{ fontSize: 11 }}>{s.name}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{s.unit || "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{s.qty.toLocaleString("id-ID")}</td>
                  </tr>
                ))}
                {stock.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>{cari ? `Tidak ada barang yang cocok dengan “${cari}” di gudang ini.` : "Belum ada stok di gudang ini. Stok akan bertambah lewat penerimaan pembelian, pemindahan masuk, atau penyesuaian stok."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {selectedWh && <ListPagination path="/pos/stok" query={saringan(semua)} total={stockCount} pageInfo={pageInfo} />}
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
