import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { flatOptions, type KategoriRow } from "@/lib/kategori";
import { simpanPengecualian, hapusPengecualian } from "./actions";

type Aturan = {
  id: string; item_id: string | null; item_category_id: string | null; diskon_persen: number;
};

export default async function DiskonGolonganPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: golongan }, { data: aturanRaw }, { data: items }, { data: kategoriRaw }] = await Promise.all([
    supabase.from("customer_categories").select("id, nama, diskon_persen, is_active").eq("id", id).maybeSingle(),
    supabase.from("category_discounts").select("id, item_id, item_category_id, diskon_persen")
      .eq("customer_category_id", id),
    supabase.from("items").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("item_categories").select("id, name, parent_id, is_active").order("name"),
  ]);

  if (!golongan) notFound();

  const aturan = ((aturanRaw ?? []) as Aturan[]).map((a) => ({ ...a, diskon_persen: Number(a.diskon_persen) }));
  const kategoriOpts = flatOptions((kategoriRaw ?? []) as KategoriRow[]);
  const namaItem = new Map((items ?? []).map((i) => [i.id, `${i.code} — ${i.name}`]));
  const namaKategori = new Map(kategoriOpts.map((k) => [k.id, k.label]));

  const dasar = Number(golongan.diskon_persen);

  return (
    <MasterPage
      back="/crm/kategori-pelanggan" icon="ti-discount" title={`DISKON — ${golongan.nama.toUpperCase()}`}
      desc={`Diskon dasar ${dasar}% untuk semua barang. Di bawah ini pengecualiannya.`}
      error={error} success={success} successMsg="Pengecualian tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah diskon golongan."
    >
      <div className="p2ban" style={{ background: "#f8fafc" }}>
        <i className="ti ti-info-circle" /> Urutan yang menang: <b>aturan per barang</b> → <b>aturan per kategori</b> →
        {" "}<b>kategori induknya</b> → diskon dasar {dasar}%. Isi 0% kalau barang tertentu justru tidak boleh didiskon.
      </div>

      {bolehKelola && (
        <form action={simpanPengecualian} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="golongan_id" value={golongan.id} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <label className="flab">Berlaku untuk *</label>
              <select className="fi" name="sasaran" required defaultValue="">
                <option value="">— pilih barang atau kategori —</option>
                <optgroup label="Kategori barang">
                  {kategoriOpts.map((k) => (
                    <option key={`k-${k.id}`} value={`kategori:${k.id}`}>{k.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Barang tertentu">
                  {(items ?? []).map((i) => (
                    <option key={`i-${i.id}`} value={`item:${i.id}`}>{i.code} — {i.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div style={{ width: 150 }}>
              <label className="flab">Diskon (%)</label>
              <input className="fi" name="diskon_persen" type="number" min={0} max={100} step="0.01"
                defaultValue={0} required />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Berlaku untuk</th>
                <th style={{ width: 110 }}>Jenis</th><th style={{ width: 90 }}>Diskon</th>
                {bolehKelola && <th style={{ width: 90 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {aturan.map((a, i) => (
                <tr key={a.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 500 }}>
                    {a.item_id
                      ? namaItem.get(a.item_id) ?? "— barang terhapus —"
                      : namaKategori.get(a.item_category_id ?? "") ?? "— kategori terhapus —"}
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{a.item_id ? "Per barang" : "Per kategori"}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{a.diskon_persen}%</td>
                  {bolehKelola && (
                    <td>
                      <form action={hapusPengecualian}>
                        <input type="hidden" name="golongan_id" value={golongan.id} />
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, color: "#b91c1c" }} pendingText="…">
                          Hapus
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {aturan.length === 0 && (
                <tr>
                  <td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada pengecualian — semua barang dapat diskon dasar {dasar}%.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Link href="/crm/kategori-pelanggan" className="btn-def" style={{ textDecoration: "none" }}>
          Kembali ke daftar golongan
        </Link>
      </div>
    </MasterPage>
  );
}
