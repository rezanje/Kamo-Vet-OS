import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { buildTree, type KategoriRow } from "@/lib/kategori";
import { simpanKategori, toggleKategori } from "./actions";

export default async function KategoriBarangPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: itemRows }] = await Promise.all([
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
    supabase.from("items").select("category_id").not("category_id", "is", null),
  ]);

  const rows = (data ?? []) as KategoriRow[];
  const tree = buildTree(rows);
  const editing = edit ? rows.find((r) => r.id === edit) ?? null : null;

  // Dihitung LANGSUNG (barang yang kategorinya persis baris ini), tidak termasuk
  // anak — supaya jelas kategori mana yang benar-benar masih dipakai.
  const pakai = new Map<string, number>();
  for (const r of itemRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  // Pilihan induk: hanya kategori yang belum jadi anak & bukan dirinya sendiri.
  const calonInduk = rows.filter((r) => !r.parent_id && r.id !== editing?.id);

  const baris: { r: KategoriRow; anak: boolean }[] = [];
  for (const t of tree) {
    baris.push({ r: t.induk, anak: false });
    for (const a of t.anak) baris.push({ r: a, anak: true });
  }

  return (
    <MasterPage
      back="/pos" icon="ti-category" title="KATEGORI BARANG"
      desc="Dua tingkat: induk → anak. Dipakai master Barang & Jasa"
      error={error} success={success} successMsg="Kategori tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah kategori barang."
    >
      {bolehKelola && (
        <form action={simpanKategori} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="flab">{editing ? "Ubah nama kategori" : "Kategori baru"}</label>
              <input className="fi" name="name" defaultValue={editing?.name ?? ""} maxLength={100} placeholder="mis. Makanan Kucing" required />
            </div>
            <div style={{ width: 220 }}>
              <label className="flab">Induk</label>
              <select className="fi" name="parent_id" defaultValue={editing?.parent_id ?? ""}>
                <option value="">— jadi kategori induk —</option>
                {calonInduk.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pos/kategori" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Kategori</th>
                <th style={{ width: 110 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {baris.map(({ r, anak }) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5, fontWeight: anak ? 500 : 700, paddingLeft: anak ? 26 : undefined }}>
                    {anak && <span style={{ color: "var(--td)", marginRight: 5 }}>└</span>}
                    {r.name}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(r.id) ?? 0} barang</td>
                  <td><span className={`bge ${r.is_active ? "g" : "x"}`}>{r.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pos/kategori?edit=${r.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategori}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="aktif" value={r.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {baris.length === 0 && (
                <tr><td colSpan={bolehKelola ? 4 : 3} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada kategori.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
