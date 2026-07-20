import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { TemplateForm, type TemplateRow } from "./TemplateForm";
import { toggleTemplate } from "./actions";

// Kelola template form persetujuan (spec 2026-07-20). Admin/owner saja.
export default async function PersetujuanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const bolehKelola = profile?.role === "OWNER" || profile?.role === "ADMIN";

  const [{ data: templates }, { data: branches }] = await Promise.all([
    supabase.from("consent_templates")
      .select("id, nama, isi, branch_id, is_active, updated_at, branches(name)")
      .order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true)
      .in("type", ["KLINIK", "BOTH"]).order("name"),
  ]);

  const rows = (templates ?? []) as unknown as (TemplateRow & { updated_at: string; branches: { name: string } | { name: string }[] | null })[];
  const editing = edit ? rows.find((r) => r.id === edit) ?? null : null;

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-file-check" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>FORM PERSETUJUAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Template yang dipakai saat meminta persetujuan tindakan</div>
        </div>
        {bolehKelola && <TemplateForm branches={branches ?? []} editing={editing} />}
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Template tersimpan.</div>}
      {!bolehKelola && (
        <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang bisa mengubah template. Kamu bisa melihat isinya saja.</div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em", marginBottom: 12 }}>DAFTAR TEMPLATE</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr><th style={{ width: 30 }}>No.</th><th>Nama</th><th>Cabang</th><th>Cuplikan isi</th><th>Status</th>{bolehKelola && <th style={{ width: 130 }}>Aksi</th>}</tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const br = Array.isArray(t.branches) ? t.branches[0] : t.branches;
                return (
                  <tr key={t.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{t.nama}</td>
                    <td style={{ fontSize: 11 }}>{br?.name ?? <span style={{ color: "var(--tm)" }}>Semua cabang</span>}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.isi.replace(/\s+/g, " ").slice(0, 70)}…
                    </td>
                    <td><span className={`bge ${t.is_active ? "g" : "x"}`}>{t.is_active ? "Aktif" : "Nonaktif"}</span></td>
                    {bolehKelola && (
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Link href={`/klinik/persetujuan?edit=${t.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Edit</Link>
                          <form action={toggleTemplate}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="aktif" value={t.is_active ? "1" : "0"} />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                              {t.is_active ? "Nonaktifkan" : "Aktifkan"}
                            </SubmitButton>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={bolehKelola ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada template. Buat satu dulu supaya staff bisa meminta persetujuan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
