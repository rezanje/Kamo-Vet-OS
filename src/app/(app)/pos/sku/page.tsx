import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { kategoriWajibConsent } from "@/lib/tindakan";
import { SkuForm, type SkuRow } from "./SkuForm";
import { toggleSku } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Master SKU obat/jasa/barang. Jasa hanya boleh dipakai di rekam medis kalau
// terdaftar di sini — dokter tidak bisa lagi mengetik jasa bebas (spec 2026-07-20).
export default async function SkuPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string; kat?: string }>;
}) {
  const { error, success, edit, kat } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const bolehKelola = profile?.role === "OWNER" || profile?.role === "ADMIN";

  const { data: categories } = await supabase.from("item_categories").select("id, name").order("name");
  const cats = categories ?? [];
  const jasaCategoryId = cats.find((c) => c.name === "Jasa")?.id ?? null;

  let q = supabase
    .from("items")
    .select("id, name, code, unit, category_id, sell_price, buy_price, is_active, tindakan_kategori")
    .order("name").limit(500);
  if (kat) q = q.eq("category_id", kat);

  const { data: items } = await q;
  const rows = (items ?? []) as unknown as SkuRow[];
  const editing = edit ? rows.find((r) => r.id === edit) ?? null : null;
  const namaKat = new Map(cats.map((c) => [c.id, c.name]));

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
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>MASTER SKU</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Daftar obat, barang & jasa yang boleh dipakai di POS dan rekam medis</div>
        </div>
        {bolehKelola && <SkuForm categories={cats} editing={editing} jasaCategoryId={jasaCategoryId} />}
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> SKU tersimpan.</div>}
      {!bolehKelola && <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang bisa mengubah master SKU. Kamu bisa melihat daftarnya saja.</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href="/pos/sku" className="back-btn" style={chip(!kat)}>Semua</Link>
        {cats.map((c) => (
          <Link key={c.id} href={`/pos/sku?kat=${c.id}`} className="back-btn" style={chip(kat === c.id)}>{c.name}</Link>
        ))}
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Nama</th><th style={{ width: 90 }}>Kode</th>
                <th style={{ width: 130 }}>Kategori</th><th style={{ width: 130 }}>Tindakan</th>
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
                    <div style={{ fontSize: 9, color: "var(--tm)" }}>{it.unit}</div>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.code || "—"}</td>
                  <td style={{ fontSize: 10.5 }}>{it.category_id ? namaKat.get(it.category_id) ?? "—" : "—"}</td>
                  <td>
                    {it.tindakan_kategori
                      ? <span className={`bge ${kategoriWajibConsent(it.tindakan_kategori) ? "r" : "b"}`}>{it.tindakan_kategori}</span>
                      : <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(Number(it.sell_price))}</td>
                  <td><span className={`bge ${it.is_active ? "g" : "x"}`}>{it.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pos/sku?edit=${it.id}${kat ? `&kat=${kat}` : ""}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>
                        <form action={toggleSku}>
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
                <tr><td colSpan={bolehKelola ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada SKU di kategori ini.
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
