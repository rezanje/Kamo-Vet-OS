import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, type ItemUnit } from "@/lib/satuan";
import { ITEM_TYPES } from "@/lib/barang";
import { BARANG_FIELDS } from "./data";
import { flatOptions, labelPath, type KategoriRow } from "@/lib/kategori";
import { BarangMatrixTable, type BarangMatrixRow } from "./BarangMatrixTable";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Row = {
  id: string; name: string; code: string | null; unit: string; category_id: string | null;
  item_type: string; sell_price: number; buy_price: number; min_stock: number; is_active: boolean;
  upc: string | null; track_expiry: boolean; supplier_id: string | null; buy_unit: string | null;
  min_buy: number; default_discount: number; tindakan_kategori: string | null;
  brands: Rel<{ name: string }>;
  suppliers: Rel<{ nama: string }>;
  units?: ItemUnit[];
};

// Master Barang & Jasa (mengikuti menu Persediaan Accurate). Jasa hanya boleh dipakai
// di rekam medis kalau terdaftar di sini — dokter tidak bisa mengetik jasa bebas.
export default async function BarangJasaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; kat?: string; jenis?: string; cari?: string }>;
}) {
  const { error, success, kat, jenis, cari } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const bolehKelola = profile?.role === "OWNER" || profile?.role === "ADMIN";

  // Kategori bertingkat: chip filter & kolom kategori pakai label "Induk › Anak"
  // supaya dua anak bernama mirip di induk berbeda tidak tertukar.
  const { data: categories } = await supabase
    .from("item_categories").select("id, name, parent_id, is_active").order("name");
  const katRows = (categories ?? []) as KategoriRow[];
  const cats = flatOptions(katRows); // chip filter: hanya kategori aktif

  let q = supabase.from("items").select(`${BARANG_FIELDS}, brands(name), suppliers(nama)`).order("name").limit(500);
  if (kat) q = q.eq("category_id", kat);
  if (jenis) q = q.eq("item_type", jenis);
  // `cari` datang dari pencarian global di topbar — layar langsung terbuka
  // menyorot barang yang dicari, bukan 500 baris yang harus ditelusuri lagi.
  if (cari) q = q.or(`name.ilike.%${cari}%,code.ilike.%${cari}%`);

  const { data: items } = await q;
  const baseRows = (items ?? []) as unknown as Row[];
  const unitMap = await loadItemUnits(supabase, baseRows.map((r) => r.id));
  const rows: Row[] = baseRows.map((r) => ({ ...r, units: unitMap.get(r.id) ?? [] }));
  // Kolom kategori dipetakan dari SEMUA kategori (termasuk yang nonaktif) — barang
  // lama tetap menunjukkan kategorinya, bukan tanda strip.
  const namaKat = new Map(katRows.map((c) => [c.id, labelPath(c.id, katRows)]));
  const matrixRows: BarangMatrixRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    item_type: row.item_type,
    category_name: row.category_id ? namaKat.get(row.category_id) ?? null : null,
    brand_name: one(row.brands)?.name ?? null,
    unit: row.unit,
    units: row.units ?? [],
    sell_price: Number(row.sell_price),
    buy_price: Number(row.buy_price),
    min_stock: Number(row.min_stock),
    supplier_name: one(row.suppliers)?.nama ?? null,
    buy_unit: row.buy_unit,
    min_buy: Number(row.min_buy),
    upc: row.upc,
    track_expiry: row.track_expiry,
    default_discount: Number(row.default_discount),
    is_active: row.is_active,
    tindakan_kategori: row.tindakan_kategori,
  }));

  const filterHref = (next: { kat?: string; jenis?: string }) => {
    const p = new URLSearchParams();
    const k = "kat" in next ? next.kat : kat;
    const j = "jenis" in next ? next.jenis : jenis;
    if (k) p.set("kat", k);
    if (j) p.set("jenis", j);
    const s = p.toString();
    return s ? `/pos/sku?${s}` : "/pos/sku";
  };

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-package" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>BARANG &amp; JASA</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Daftar obat, barang & jasa yang boleh dipakai di POS dan rekam medis</div>
        </div>
        {bolehKelola && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <Link href="/pos/sku/impor" className="btn-def" style={{ textDecoration: "none" }}>
              <i className="ti ti-file-spreadsheet" /> Impor CSV
            </Link>
            <Link href="/pos/sku/baru" className="btn-acc" style={{ background: "var(--posb)", textDecoration: "none" }}>
              <i className="ti ti-plus" /> Barang Baru
            </Link>
          </div>
        )}
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {/* Impor massal mengirim ringkasannya sendiri (berapa masuk, berapa dilewati). */}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success === "1" ? "Barang tersimpan." : success}</div>}
      {!bolehKelola && <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang bisa mengubah master barang. Kamu bisa melihat daftarnya saja.</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <Link href={filterHref({ jenis: undefined })} className="back-btn" style={chip(!jenis)}>Semua jenis</Link>
        {ITEM_TYPES.map((t) => (
          <Link key={t} href={filterHref({ jenis: t })} className="back-btn" style={chip(jenis === t)}>{t}</Link>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href={filterHref({ kat: undefined })} className="back-btn" style={chip(!kat)}>Semua kategori</Link>
        {cats.map((c) => (
          <Link key={c.id} href={filterHref({ kat: c.id })} className="back-btn" style={chip(kat === c.id)}>{c.label}</Link>
        ))}
      </div>

      <BarangMatrixTable rows={matrixRows} bolehKelola={bolehKelola} />
    </>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: "none",
    border: ".5px solid var(--bd)", background: active ? "#2563eb" : "#fff", color: active ? "#fff" : "var(--tm)",
  };
}
