import { MasterLifecycleActions } from "@/components/MasterLifecycleActions";
import { MasterLifecycleFilter } from "@/components/MasterLifecycleFilter";
import { masterView, visibleMasters, type LifecycleRow } from "@/lib/master-lifecycle";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanSatuan } from "./actions";

type Unit = { id: string; nama: string; is_active: boolean } & LifecycleRow;

export default async function SatuanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string; view?: string }>;
}) {
  const { error, success, edit, view: viewRaw } = await searchParams;
  const view = masterView(viewRaw);
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: itemRows }, { data: unitRows }] = await Promise.all([
    supabase.from("units").select("id, nama, is_active, trashed_at, lifecycle_revision").order("nama"),
    supabase.from("items").select("unit"),
    supabase.from("item_units").select("unit"),
  ]);

  const units = visibleMasters((data ?? []) as Unit[], view, row => row.is_active);

  // "Dipakai" = satuan dasar barang + satuan turunan; keduanya dihitung supaya
  // satuan yang kelihatan kosong benar-benar aman dinonaktifkan.
  const pakai = new Map<string, number>();
  for (const r of [...(itemRows ?? []), ...(unitRows ?? [])]) {
    const k = String((r as { unit: string | null }).unit ?? "");
    if (k) pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  const editing = edit ? units.find((u) => u.id === edit && !u.trashed_at) ?? null : null;

  return (
    <MasterPage
      back="/pos" icon="ti-scale-outline" title="SATUAN BARANG"
      desc="Daftar satuan resmi — dipakai master Barang & Jasa"
      error={error} success={success} successMsg={success === "1" ? "Satuan tersimpan." : success ?? ""}
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah satuan."
    >
      {bolehKelola && (
        <form action={simpanSatuan} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="flab">{editing ? "Ubah nama satuan" : "Satuan baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={20} placeholder="mis. box" required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Disimpan huruf kecil semua supaya tidak kembar.
              </div>
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pos/satuan" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <MasterLifecycleFilter entity="units" view={view} />
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Satuan</th>
                <th style={{ width: 110 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{u.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(u.nama) ?? 0} barang</td>
                  <td><span className={`bge ${u.is_active ? "g" : "x"}`}>{u.trashed_at ? "Sampah" : u.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {!u.trashed_at && <Link href={`/pos/satuan?edit=${u.id}&view=${view}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>}
                        <MasterLifecycleActions entity="units" id={u.id} name={u.nama} active={u.is_active} trashed={Boolean(u.trashed_at)} revision={u.lifecycle_revision} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {units.length === 0 && (
                <tr><td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada satuan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
