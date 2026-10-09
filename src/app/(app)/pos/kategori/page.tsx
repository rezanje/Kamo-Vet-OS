import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { buildTree, labelPath, flatOptions, type KategoriRow } from "@/lib/kategori";
import { simpanKategori, toggleKategori, hapusKategori } from "./actions";

async function categoryUsage(supabase: Awaited<ReturnType<typeof createClient>>) {
  const counts = new Map<string, number>();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("items").select("category_id")
      .not("category_id", "is", null).order("id").range(start, start + 999);
    if (error) throw new Error(error.message);
    for (const item of data ?? []) counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1);
    if ((data ?? []).length < 1000) return counts;
  }
}

export default async function KategoriBarangPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string; hapus?: string }>;
}) {
  const { error, success, edit, hapus } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data, error: categoryError }, pakai] = await Promise.all([
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
    categoryUsage(supabase),
  ]);

  if (categoryError) throw new Error(categoryError.message);
  const rows = (data ?? []) as KategoriRow[];
  const tree = buildTree(rows);
  const editing = edit ? rows.find((r) => r.id === edit) ?? null : null;
  const deleting = hapus ? rows.find(r => r.id === hapus) ?? null : null;
  const childCount = deleting ? rows.filter(r => r.parent_id === deleting.id).length : 0;
  const itemCount = deleting ? pakai.get(deleting.id) ?? 0 : 0;
  const needsReplacement = itemCount > 0 || childCount > 0;
  const descendants = new Set(deleting ? [deleting.id] : []);
  let previousSize = -1;
  while (previousSize !== descendants.size) {
    previousSize = descendants.size;
    rows.forEach(row => { if (row.parent_id && descendants.has(row.parent_id)) descendants.add(row.id); });
  }
  const replacements = flatOptions(rows).filter(option => !descendants.has(option.id)
    && (!childCount || !rows.find(row => row.id === option.id)?.parent_id));

  // Dihitung LANGSUNG (barang yang kategorinya persis baris ini), tidak termasuk
  // anak — supaya jelas kategori mana yang benar-benar masih dipakai.

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
      {bolehKelola && deleting && (
        <form key={deleting.id} action={hapusKategori} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={deleting.id} />
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Hapus kategori {deleting.name}?</h2>
          <p>{itemCount} barang langsung dan {childCount} subkategori memakai kategori ini.</p>
          {needsReplacement ? (
            <>
              <p>Pilih tujuan pemindahan. Barang, stok, dan transaksi tetap disimpan; subkategori ikut pindah ke induk pengganti.</p>
              <label className="flab" htmlFor="replacement-category">Pindahkan ke kategori</label>
              <select id="replacement-category" className="fi" name="replacement_id" required defaultValue="" style={{ maxWidth: 420 }}>
                <option value="">— pilih kategori pengganti —</option>
                {replacements.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              {replacements.length === 0 && <p>Belum ada tujuan yang sesuai. Buat kategori induk aktif terlebih dahulu.</p>}
            </>
          ) : <p>Kategori ini kosong dan dapat dihapus jika tidak dipakai aturan lain.</p>}
          <p style={{ fontSize: 12 }}>Jika masih dipakai aturan diskon, komisi, target penjualan, atau varian barang, penghapusan ditolak dan seluruh pemindahan dibatalkan. Sesuaikan aturan tersebut terlebih dahulu.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <SubmitButton className="btn-acc" pendingText="Menghapus…" disabled={needsReplacement && replacements.length === 0}>
              {needsReplacement ? "Pindahkan dan hapus" : "Hapus kategori ini"}
            </SubmitButton>
            <Link href="/pos/kategori" className="btn-def">Batal</Link>
          </div>
        </form>
      )}
      {bolehKelola && (
        <form key={editing?.id ?? "new"} action={simpanKategori} className="crm-sec" style={{ marginBottom: 14 }}>
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
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
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
                {bolehKelola && <th style={{ width: 210 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {baris.map(({ r, anak }) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5, fontWeight: anak ? 500 : 700, paddingLeft: anak ? 26 : undefined }}>
                    {anak && <span style={{ color: "var(--td)", marginRight: 5 }}>└</span>}
                    {anak ? labelPath(r.id, rows).split(" › ").slice(1).join(" › ") : r.name}
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
                        <Link href={`/pos/kategori?hapus=${r.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c", textDecoration: "none" }}>Hapus</Link>
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
