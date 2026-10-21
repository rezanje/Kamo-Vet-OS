import { MasterLifecycleActions } from "@/components/MasterLifecycleActions";
import { MasterLifecycleFilter } from "@/components/MasterLifecycleFilter";
import { masterView, visibleMasters, type LifecycleRow } from "@/lib/master-lifecycle";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriPemasok } from "./actions";

type Kat = { id: string; nama: string; is_active: boolean } & LifecycleRow;

export default async function KategoriPemasokPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string; view?: string }>;
}) {
  const { error, success, edit, view: viewRaw } = await searchParams;
  const view = masterView(viewRaw);
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: supRows }] = await Promise.all([
    supabase.from("supplier_categories").select("id, nama, is_active, trashed_at, lifecycle_revision").order("nama"),
    supabase.from("suppliers").select("category_id").not("category_id", "is", null),
  ]);

  const kategori = visibleMasters((data ?? []) as Kat[], view, row => row.is_active);
  const editing = edit ? kategori.find((k) => k.id === edit && !k.trashed_at) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of supRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/pembelian" icon="ti-tag" title="KATEGORI PEMASOK"
      desc="Golongkan pemasok — dipakai daftar pemasok & laporan hutang"
      error={error} success={success} successMsg={success === "1" ? "Kategori tersimpan." : success ?? ""}
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
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pembelian/kategori-pemasok" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <MasterLifecycleFilter entity="supplier_categories" view={view} />
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
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.trashed_at ? "Sampah" : k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {!k.trashed_at && <Link href={`/pembelian/kategori-pemasok?edit=${k.id}&view=${view}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>}
                        <MasterLifecycleActions entity="supplier_categories" id={k.id} name={k.nama} active={k.is_active} trashed={Boolean(k.trashed_at)} revision={k.lifecycle_revision} />
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
