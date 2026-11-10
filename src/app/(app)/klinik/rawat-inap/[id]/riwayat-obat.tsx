import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompleteList } from "@/lib/checked-list";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Bahan = { nama: string; qty: number; satuan: string };
export type BarisRiwayatObat = { id: string; waktu: string; nama: string; qty: number; satuan: string; aturan: string | null; racikan: boolean; batal: boolean; bahan: Bahan[]; bmhp: Bahan[] };

type Row = {
  id: string; created_at: string; jenis: string; nama_obat: string; qty: number; satuan: string | null; aturan_pakai: string | null;
  bmhp_components: { name?: string; qty?: number; unit?: string }[] | null;
  compounding_recipes: Rel<{ status: string; compounding_ingredients: { ingredient_name: string; quantity: number; unit: string }[] | null }>;
};

/** Pure: obat, racikan (dengan bahannya) dan baris ber-BMHP; jasa tanpa BMHP (admin, konsultasi, inap) tidak ikut. */
export function susunRiwayatObat(rows: Row[]): BarisRiwayatObat[] {
  return rows.flatMap((r) => {
    const recipe = one(r.compounding_recipes);
    const bmhp = (r.bmhp_components ?? []).map((c) => ({ nama: String(c.name ?? "BMHP"), qty: Number(c.qty ?? 0), satuan: String(c.unit ?? "") }));
    if (r.jenis !== "obat" && !recipe && !bmhp.length) return [];
    return [{
      id: r.id, waktu: r.created_at, nama: r.nama_obat, qty: Number(r.qty), satuan: r.satuan ?? "", aturan: r.aturan_pakai,
      racikan: !!recipe, batal: recipe?.status === "void",
      bahan: (recipe?.compounding_ingredients ?? []).map((b) => ({ nama: b.ingredient_name, qty: Number(b.quantity), satuan: b.unit })),
      bmhp,
    }];
  });
}

/** Satu bacaan lengkap per kunjungan; gagal/terpotong = null ("tidak terbaca", bukan "belum ada"). */
export async function bacaRiwayatObat(supabase: Pick<SupabaseClient, "from">, visitId: string): Promise<BarisRiwayatObat[] | null> {
  try {
    // Pola sama dengan ringkasan handoff: rekam medis kunjungan dulu, lalu resep per ID rekam medis.
    const records = await readCompleteList<{ id: string }>((from, to) => supabase.from("medical_records")
      .select("id", { count: "exact" }).eq("visit_id", visitId).order("id").range(from, to) as unknown as PromiseLike<{ data: { id: string }[] | null; count: number | null; error: unknown }>,
    "Rekam medis riwayat obat", { maxRows: null });
    const rows: Row[] = [];
    for (let offset = 0; offset < records.length; offset += 200) {
      const ids = records.slice(offset, offset + 200).map((r) => r.id);
      rows.push(...await readCompleteList<Row>((from, to) => supabase.from("prescription_items")
        .select("id, created_at, jenis, nama_obat, qty, satuan, aturan_pakai, bmhp_components, compounding_recipes(status, compounding_ingredients(ingredient_name, quantity, unit))", { count: "exact" })
        .in("medical_record_id", ids).is("record_withdrawn_at", null)
        .order("created_at").order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; count: number | null; error: unknown }>,
      "Riwayat obat", { maxRows: null }));
    }
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    return susunRiwayatObat(rows);
  } catch {
    return null;
  }
}

const tgl = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "numeric", year: "2-digit" });
const qty = (n: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(n);
const daftar = (xs: Bahan[]) => xs.map((b) => `${b.nama} ${qty(b.qty)} ${b.satuan}`.trim()).join(", ");

/** Ringkasan riwayat obat ranap: hanya untuk dibaca — tanpa tautan, tombol, atau form. */
export function RiwayatObat({ rows }: { rows: BarisRiwayatObat[] | null }) {
  return <section id="riwayat-obat" className="crm-sec" aria-label="Riwayat obat pasien">
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <i className="ti ti-pill" style={{ fontSize: 18, color: "var(--posb)" }} />
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em" }}>RIWAYAT OBAT</div>
    </div>
    <p style={{ fontSize: 11, color: "var(--tm)", margin: "0 0 8px" }}>Semua obat, racikan, dan BMHP pasien ini, urut tanggal. Hanya untuk dibaca.</p>
    {rows === null && <p role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>Riwayat obat tidak terbaca. Muat ulang halaman.</p>}
    {rows?.length === 0 && <p style={{ fontSize: 12, color: "var(--td)" }}>Belum ada obat untuk pasien ini.</p>}
    {!!rows?.length && <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 520 }}>
      <thead><tr><th style={{ width: 80 }}>Tanggal</th><th>Obat</th><th style={{ width: 90 }}>Jumlah</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id} style={r.batal ? { opacity: 0.55 } : undefined}>
        <td style={{ fontSize: 11.5, whiteSpace: "nowrap", verticalAlign: "top" }}>{i > 0 && tgl(rows[i - 1].waktu) === tgl(r.waktu) ? "" : tgl(r.waktu)}</td>
        <td style={{ fontSize: 12, verticalAlign: "top" }}>
          <span style={r.batal ? { textDecoration: "line-through" } : undefined}>{r.nama}</span>
          {r.racikan && <span className="bge b" style={{ marginLeft: 5, fontSize: 8 }}>racikan</span>}
          {r.batal && <span className="bge o" style={{ marginLeft: 5, fontSize: 8 }}>dibatalkan</span>}
          {r.bahan.length > 0 && <div style={{ fontSize: 11, color: "var(--tm)" }}>Isi: {daftar(r.bahan)}</div>}
          {r.bmhp.length > 0 && <div style={{ fontSize: 11, color: "var(--tm)" }}>BMHP: {daftar(r.bmhp)}</div>}
          {r.aturan && <div style={{ fontSize: 11, color: "var(--td)" }}>Aturan pakai: {r.aturan}</div>}
        </td>
        <td style={{ fontSize: 11.5, whiteSpace: "nowrap", verticalAlign: "top" }}>{qty(r.qty)} {r.satuan}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
