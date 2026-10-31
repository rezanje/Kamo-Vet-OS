import { NumberInput } from "@/components/NumberInput";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { unitOptions, type ItemUnit } from "@/lib/satuan";
import { readCompleteList, readListPage } from "@/lib/checked-list";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { simpanHargaJual } from "./actions";

type ItemRow = { id: string; code: string; name: string; unit: string; sell_price: number };
type PriceRow = { id: string; item_id: string; unit: string; branch_id: string; sell_price?: number };

export default async function HargaJualPage({
  searchParams,
}: {
  searchParams: Promise<{ cabang?: string; q?: string; hal?: string; error?: string; success?: string }>;
}) {
  const { cabang = "", q = "", hal, error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  let loaded;
  try {
    const branches = await readCompleteList<{ id: string; code: string; name: string }>((from, to) => supabase
      .from("branches").select("id, code, name", { count: "exact" }).eq("is_active", true)
      .order("code").order("id").range(from, to), "Cabang harga", { maxRows: null });
    const branchId = branches.some(branch => branch.id === cabang) ? cabang : "";
    const page = await readListPage<ItemRow>((from, to) => {
      let query = supabase.from("items").select("id, code, name, unit, sell_price", { count: "exact" }).eq("is_active", true);
      if (q.trim()) query = query.or(`name.ilike.%${q.trim()}%,code.ilike.%${q.trim()}%`);
      return query.order("name").order("id").range(from, to);
    }, "Daftar harga barang", hal);
    const ids = page.rows.map(item => item.id);
    const [unitRows, overrideRows] = ids.length ? await Promise.all([
      readCompleteList<ItemUnit & { id: string; item_id: string }>((from, to) => supabase.from("item_units")
        .select("id,item_id,unit,factor,sell_price,buy_price", { count: "exact" }).in("item_id", ids)
        .order("id").range(from, to), "Satuan harga barang", { maxRows: null }),
      readCompleteList<PriceRow>((from, to) => {
        // Base view only needs override counts; selected-branch prices stay scoped.
        if (branchId) return supabase.from("item_branch_prices")
          .select("id,item_id,unit,branch_id,sell_price", { count: "exact" }).in("item_id", ids).eq("branch_id", branchId)
          .order("id").range(from, to);
        return supabase.from("item_branch_prices")
          .select("id,item_id,unit,branch_id", { count: "exact" }).in("item_id", ids)
          .order("id").range(from, to);
      }, "Pengecualian harga cabang", { maxRows: null }),
    ]) : [[], []];
    loaded = { branches, branchId, ...page, unitRows, overrideRows };
  } catch (loadError) { return <ListLoadFailure error={loadError} label="Daftar harga" />; }
  const { branches, branchId, rows: items, count, pageInfo, unitRows, overrideRows } = loaded;
  const unitMap = new Map<string, ItemUnit[]>();
  for (const row of unitRows) {
    const list = unitMap.get(row.item_id) ?? [];
    list.push({ unit: row.unit, factor: Number(row.factor), sell_price: Number(row.sell_price), buy_price: Number(row.buy_price) });
    unitMap.set(row.item_id, list);
  }
  const hargaMap = new Map<string, number>();
  const jumlahOverride = new Map<string, number>();
  for (const r of overrideRows) {
    const k = `${r.item_id}|${r.unit}`;
    jumlahOverride.set(k, (jumlahOverride.get(k) ?? 0) + 1);
    if (branchId && r.branch_id === branchId) hargaMap.set(k, Number(r.sell_price));
  }

  const baris = items.flatMap((it) =>
    unitOptions({ unit: it.unit, sell_price: Number(it.sell_price) }, unitMap.get(it.id) ?? []).map((u, idx) => ({
      item: it, unit: u.unit, faktor: u.factor, hargaPusat: u.sell_price, pertama: idx === 0,
      override: hargaMap.get(`${it.id}|${u.unit}`),
      dipakaiCabangLain: jumlahOverride.get(`${it.id}|${u.unit}`) ?? 0,
    })),
  );

  const namaCabang = branches.find((b) => b.id === branchId)?.name ?? "Semua Cabang";

  return (
    <MasterPage
      back="/pos" icon="ti-tag" title="HARGA JUAL"
      desc="Satu tempat untuk semua harga jual — bisa beda tiap cabang"
      error={error} success={success} successMsg="Harga jual tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah harga jual."
    >
      {/* Pemilih cabang + pencarian: GET biasa, biar bisa di-bookmark & di-refresh. */}
      <form className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={branchId}>
              <option value="">Semua Cabang</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="flab">Cari barang</label>
            <input className="fi" name="q" defaultValue={q} placeholder="nama atau kode barang" />
          </div>
          <SubmitButton className="btn-def" icon="ti-refresh" pendingText="Memuat…">Tampilkan</SubmitButton>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6 }}>
          {branchId
            ? <>Kosongkan kolom harga cabang kalau <b>{namaCabang}</b> ikut harga Semua Cabang.</>
            : <>Harga <b>Semua Cabang</b> = harga dasar. Cabang yang tidak dikecualikan ikut harga ini.</>}
        </div>
      </form>

      <form action={simpanHargaJual} className="crm-sec" style={{ marginBottom: 0 }}>
        <input type="hidden" name="branch_id" value={branchId} />
        <input type="hidden" name="q" value={q} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            <i className="ti ti-tag" /> {namaCabang}
            <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--tm)" }}> · {baris.length} baris harga</span>
          </div>
          {bolehKelola && baris.length > 0 && (
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan harga halaman ini
            </SubmitButton>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Kode</th>
                <th>Barang</th>
                <th style={{ width: 90 }}>Satuan</th>
                <th style={{ width: 80 }}>Isi</th>
                <th style={{ width: 130, textAlign: "right" }}>Semua Cabang</th>
                {branchId && <th style={{ width: 150, textAlign: "right" }}>Harga {namaCabang}</th>}
                {!branchId && <th style={{ width: 130 }}>Dikecualikan</th>}
              </tr>
            </thead>
            <tbody>
              {baris.map((r) => (
                <tr key={`${r.item.id}|${r.unit}`}>
                  <td style={{ fontSize: 10.5, fontFamily: "var(--mono, monospace)", color: "var(--tm)" }}>
                    {r.pertama ? r.item.code : ""}
                  </td>
                  <td style={{ fontSize: 11 }}>{r.pertama ? r.item.name : ""}</td>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{r.unit}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    {r.faktor === 1 ? "dasar" : `${r.faktor} ${r.item.unit}`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {branchId ? (
                      <span style={{ fontSize: 11 }}>{rp(r.hargaPusat)}</span>
                    ) : (
                      <NumberInput className="fi" name={`h|${r.item.id}|${r.unit}`} type="number" min={0} step="any"
                        defaultValue={r.hargaPusat} disabled={!bolehKelola}
                        style={{ textAlign: "right", height: 26, fontSize: 11 }} />
                    )}
                  </td>
                  {branchId && (
                    <td style={{ textAlign: "right" }}>
                      <NumberInput className="fi" name={`h|${r.item.id}|${r.unit}`} type="number" min={0} step="any"
                        defaultValue={r.override ?? ""} placeholder="ikut pusat" disabled={!bolehKelola}
                        style={{ textAlign: "right", height: 26, fontSize: 11 }} />
                    </td>
                  )}
                  {!branchId && (
                    <td style={{ fontSize: 10.5, color: r.dipakaiCabangLain ? "#d97706" : "var(--td)" }}>
                      {r.dipakaiCabangLain ? `${r.dipakaiCabangLain} cabang` : "—"}
                    </td>
                  )}
                </tr>
              ))}
              {baris.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  {q ? "Tidak ada barang yang cocok." : "Belum ada barang aktif."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <ListPagination path="/pos/harga" query={{ cabang: branchId, q }} total={count} pageInfo={pageInfo} lompat={false} />

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
          Harga beli & HPP tidak diatur di sini: HPP tetap dihitung rata-rata dari pembelian yang benar-benar masuk.
          {" "}Atur kemasan & satuan di <Link href="/pos/sku" style={{ color: "#2563eb" }}>Barang &amp; Jasa</Link>.
        </div>
      </form>
    </MasterPage>
  );
}

const rp = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
