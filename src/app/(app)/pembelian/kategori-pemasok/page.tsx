import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriPemasok, toggleKategoriPemasok } from "./actions";

type Kat = { id: string; nama: string; is_active: boolean };

export default async function KategoriPemasokPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: supRows }] = await Promise.all([
    supabase.from("supplier_categories").select("id, nama, is_active").order("nama"),
    supabase.from("suppliers").select("category_id").not("category_id", "is", null),
  ]);

  const kategori = (data ?? []) as Kat[];
  const editing = edit ? kategori.find((k) => k.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of supRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/pembelian" icon="ti-tag" title="KATEGORI PEMASOK"
      desc="Golongkan pemasok — dipakai daftar pemasok & laporan hutang"
      error={error} success={success} successMsg="Kategori tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah kategori pemasok."
    >
      {bolehKelola && (
        <form action={simpanKategoriPemasok} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="flab">{editing ? "Ubah nama kategori" : "Kategori baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60} placeholder="mis. Pakan" required />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pembelian/kategori-pemasok" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Kategori</th>
                <th style={{ width: 120 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {kategori.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(k.id) ?? 0} pemasok</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pembelian/kategori-pemasok?edit=${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleKategoriPemasok}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kategori.length === 0 && (
                <tr><td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
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
