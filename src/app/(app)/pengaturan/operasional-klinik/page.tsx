import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { tambahKapasitasRawatInap } from "./actions";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

export default async function OperasionalKlinikSettings({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: branches }, { data: periods }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("branch_capacity_periods").select("id,branch_id,capacity,valid_from,valid_until,created_at,branches(name)").order("valid_from", { ascending: false }),
  ]);
  const boleh = profile?.role === "OWNER" || profile?.role === "ADMIN";
  return (
    <>
      <div style={{ marginBottom: 4 }}><Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Pengaturan</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#fffbeb", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-bed" style={{ fontSize: 22, color: "#d97706" }} /></div>
        <div><div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>OPERASIONAL KLINIK</div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>Kapasitas rawat inap dan periode berlakunya</div></div>
      </div>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-circle-check" /> Kapasitas tersimpan. Periode lama tidak ditimpa.</div>}
      {boleh ? (
        <form action={tambahKapasitasRawatInap} className="crm-sec" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Tambah periode kapasitas</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 11 }}>
            <label className="flab">Cabang<select className="fi" name="branch_id" required><option value="">Pilih cabang…</option>{(branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label className="flab">Jumlah kandang<input className="fi" name="capacity" type="number" min="1" step="1" required /></label>
            <label className="flab">Berlaku mulai<input className="fi" name="valid_from" type="date" required /></label>
            <label className="flab">Berlaku sampai<input className="fi" name="valid_until" type="date" /></label>
          </div>
          <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ marginTop: 11, background: "var(--posb)" }}>Simpan periode</SubmitButton>
        </form>
      ) : <div className="p2ban"><i className="ti ti-lock" /> Hanya OWNER/ADMIN yang bisa mengubah kapasitas.</div>}
      <section className="crm-sec">
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Riwayat kapasitas</div>
        <div style={{ overflowX: "auto", marginTop: 9 }}><table className="tbl"><thead><tr><th>Cabang</th><th>Kapasitas</th><th>Mulai</th><th>Sampai</th></tr></thead><tbody>
          {(periods ?? []).map((period) => <tr key={period.id}><td>{one(period.branches as Rel<{ name: string }>)?.name ?? "—"}</td><td>{period.capacity} kandang</td><td>{period.valid_from}</td><td>{period.valid_until ?? "Berjalan"}</td></tr>)}
          {!periods?.length && <tr><td colSpan={4} style={{ color: "var(--td)", textAlign: "center" }}>Belum ada kapasitas. Dashboard okupansi akan berstatus missing.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}
