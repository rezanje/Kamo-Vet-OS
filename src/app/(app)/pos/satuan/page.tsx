import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanSatuan, toggleSatuan } from "./actions";

type Unit = { id: string; nama: string; is_active: boolean };

export default async function SatuanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: itemRows }, { data: unitRows }] = await Promise.all([
    supabase.from("units").select("id, nama, is_active").order("nama"),
    supabase.from("items").select("unit"),
    supabase.from("item_units").select("unit"),
  ]);

  const units = (data ?? []) as Unit[];

  // "Dipakai" = satuan dasar barang + satuan turunan; keduanya dihitung supaya
  // satuan yang kelihatan kosong benar-benar aman dinonaktifkan.
  const pakai = new Map<string, number>();
  for (const r of [...(itemRows ?? []), ...(unitRows ?? [])]) {
    const k = String((r as { unit: string | null }).unit ?? "");
    if (k) pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  const editing = edit ? units.find((u) => u.id === edit) ?? null : null;

  return (
    <MasterPage
      back="/pos" icon="ti-scale-outline" title="SATUAN BARANG"
      desc="Daftar satuan resmi — dipakai master Barang & Jasa"
      error={error} success={success} successMsg="Satuan tersimpan."
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
                  <td><span className={`bge ${u.is_active ? "g" : "x"}`}>{u.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/pos/satuan?edit=${u.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleSatuan}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="aktif" value={u.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {u.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
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
