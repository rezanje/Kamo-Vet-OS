import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { kategoriWajibConsent } from "@/lib/tindakan";
import { loadItemUnits, type ItemUnit } from "@/lib/satuan";
import { ITEM_TYPES } from "@/lib/barang";
import { BARANG_FIELDS } from "./data";
import { toggleBarang } from "./actions";
import { flatOptions, labelPath, type KategoriRow } from "@/lib/kategori";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Row = {
  id: string; name: string; code: string | null; unit: string; category_id: string | null;
  item_type: string; sell_price: number; is_active: boolean; tindakan_kategori: string | null;
  brands: Rel<{ name: string }>;
  units?: ItemUnit[];
};

// Master Barang & Jasa (mengikuti menu Persediaan Accurate). Jasa hanya boleh dipakai
// di rekam medis kalau terdaftar di sini — dokter tidak bisa mengetik jasa bebas.
export default async function BarangJasaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; kat?: string; jenis?: string }>;
}) {
  const { error, success, kat, jenis } = await searchParams;
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

  let q = supabase.from("items").select(`${BARANG_FIELDS}, brands(name)`).order("name").limit(500);
  if (kat) q = q.eq("category_id", kat);
  if (jenis) q = q.eq("item_type", jenis);

  const { data: items } = await q;
  const baseRows = (items ?? []) as unknown as Row[];
  const unitMap = await loadItemUnits(supabase, baseRows.map((r) => r.id));
  const rows: Row[] = baseRows.map((r) => ({ ...r, units: unitMap.get(r.id) ?? [] }));
  // Kolom kategori dipetakan dari SEMUA kategori (termasuk yang nonaktif) — barang
  // lama tetap menunjukkan kategorinya, bukan tanda strip.
  const namaKat = new Map(katRows.map((c) => [c.id, labelPath(c.id, katRows)]));

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
            <Link href="/pos/sku/baru" className="btn-acc" style={{ background: "#2563eb", textDecoration: "none" }}>
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

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Nama</th><th style={{ width: 90 }}>Kode</th>
                <th style={{ width: 110 }}>Jenis</th>
                <th style={{ width: 120 }}>Kategori</th><th style={{ width: 110 }}>Merek</th>
                <th style={{ width: 120 }}>Tindakan</th>
                <th style={{ width: 110, textAlign: "right" }}>Harga jual</th>
                <th style={{ width: 80 }}>Status</th>{bolehKelola && <th style={{ width: 130 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((it, i) => (
                <tr key={it.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {it.name}
                    <div style={{ fontSize: 9, color: "var(--tm)" }}>
                      {it.unit}
                      {(it.units ?? []).map((u) => (
                        <span key={u.unit} style={{ color: "var(--td)" }}> · 1 {u.unit} = {u.factor} {it.unit}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.code || "—"}</td>
                  <td style={{ fontSize: 10.5 }}>{it.item_type}</td>
                  <td style={{ fontSize: 10.5 }}>{it.category_id ? namaKat.get(it.category_id) ?? "—" : "—"}</td>
                  <td style={{ fontSize: 10.5 }}>{one(it.brands)?.name ?? "—"}</td>
                  <td>
                    {it.tindakan_kategori
                      ? <span className={`bge ${kategoriWajibConsent(it.tindakan_kategori) ? "r" : "b"}`}>{it.tindakan_kategori}</span>
                      : <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                    {rp(Number(it.sell_price))}
                    <div style={{ fontSize: 9, fontWeight: 400, color: "var(--tm)" }}>/ {it.unit}</div>
                    {(it.units ?? []).map((u) => (
                      <div key={u.unit} style={{ fontSize: 9.5, fontWeight: 500, color: "var(--tm)" }}>
                        {rp(u.sell_price)} <span style={{ fontWeight: 400, color: "var(--td)" }}>/ {u.unit}</span>
                      </div>
                    ))}
                  </td>
                  <td><span className={`bge ${it.is_active ? "g" : "x"}`}>{it.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pos/sku/${it.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>
                        <form action={toggleBarang}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="aktif" value={it.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {it.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={bolehKelola ? 10 : 9} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada barang di filter ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: "none",
    border: ".5px solid var(--bd)", background: active ? "#2563eb" : "#fff", color: active ? "#fff" : "var(--tm)",
  };
}
