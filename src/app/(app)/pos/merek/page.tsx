import { MasterLifecycleActions } from "@/components/MasterLifecycleActions";
import { MasterLifecycleFilter } from "@/components/MasterLifecycleFilter";
import { masterView, visibleMasters, type LifecycleRow } from "@/lib/master-lifecycle";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanMerek } from "./actions";

type Brand = { id: string; name: string; is_active: boolean } & LifecycleRow;

export default async function MerekPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string; view?: string }>;
}) {
  const { error, success, edit, view: viewRaw } = await searchParams;
  const view = masterView(viewRaw);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  const bolehKelola = profile?.is_active === true && (profile.role === "OWNER" || profile.role === "ADMIN");

  const { data } = await supabase.from("brands").select("id, name, is_active, trashed_at, lifecycle_revision").order("name");
  const brands = visibleMasters((data ?? []) as Brand[], view, row => row.is_active);
  const editing = edit ? brands.find((b) => b.id === edit && !b.trashed_at) ?? null : null;

  const { data: pakai } = await supabase.from("items").select("brand_id").not("brand_id", "is", null);
  const jumlahBarang = new Map<string, number>();
  for (const r of pakai ?? []) {
    const k = r.brand_id as string;
    jumlahBarang.set(k, (jumlahBarang.get(k) ?? 0) + 1);
  }

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-badge" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>MEREK BARANG</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Dipakai di master Barang &amp; Jasa</div>
        </div>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {success === "1" ? "Merek tersimpan." : success}</div>}
      {!bolehKelola && <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang bisa mengubah merek.</div>}

      {bolehKelola && (
        <form action={simpanMerek} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="flab">{editing ? "Ubah nama merek" : "Merek baru"}</label>
              <input className="fi" name="name" defaultValue={editing?.name ?? ""} placeholder="mis. Royal Canin" required />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/pos/merek" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <MasterLifecycleFilter entity="brands" view={view} />
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Merek</th>
                <th style={{ width: 110 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {brands.map((b, i) => (
                <tr key={b.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{b.name}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{jumlahBarang.get(b.id) ?? 0} barang</td>
                  <td><span className={`bge ${b.is_active ? "g" : "x"}`}>{b.trashed_at ? "Sampah" : b.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {!b.trashed_at && <Link href={`/pos/merek?edit=${b.id}&view=${view}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>}
                        <MasterLifecycleActions entity="brands" id={b.id} name={b.name} active={b.is_active} trashed={Boolean(b.trashed_at)} revision={b.lifecycle_revision} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {brands.length === 0 && (
                <tr><td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada merek.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
