import { ALL_BRANCHES } from "@/lib/operational-context";
import { allowedBranchIds } from "@/lib/branch-access";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { availableOperationalBranches } from "@/lib/operational-branch";
import { bolehBukaPath } from "@/lib/akses";
import { getOpenShift } from "@/lib/shift";
import { pilihCabang } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function BranchSelectionPage({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string }> }) {
  const { mode, error } = await searchParams;
  if (mode !== "klinik" && mode !== "petshop") redirect("/mulai");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: rules, error: rulesError }] = await Promise.all([
    client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle(),
    client.from("role_modules").select("role, module_id"),
  ]);
  if (rulesError || !profile?.is_active || !bolehBukaPath(profile.role, mode === "klinik" ? "/klinik" : "/kasir", rules ?? [])) redirect("/mulai");
  let branches: Awaited<ReturnType<typeof availableOperationalBranches>> = [];
  let loadError = "";
  try { branches = await availableOperationalBranches(client, user.id, mode); }
  catch { loadError = "Cabang gagal dimuat. Muat ulang untuk mencoba lagi."; }
  const canViewAll = mode === "klinik" && await allowedBranchIds(client, user.id) === null;
  const shift = await getOpenShift(client, user.id, mode);
  return <main className="pshop-wrap" style={{ minHeight: "100vh", borderRadius: 0 }}>
    <div className="card pshop-card" style={{ width: "100%", maxWidth: 480, padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Pilih cabang {mode === "klinik" ? "klinik" : "petshop"}</h1>
      <p style={{ color: "var(--tm)" }}>Cabang ini menjadi tempat kerja aktif. Data dan tindakan operasional mengikuti cabang yang dipilih.</p>
      {(error || loadError) && <p role="alert" style={{ color: "#b91c1c" }}>{error || loadError}</p>}
      {shift && <p role="status">Shift berjalan di {shift.branchName}. Tutup shift sebelum pindah cabang.</p>}
      {branches.length ? <form action={pilihCabang}>
        <input type="hidden" name="mode" value={mode} />
        <label htmlFor="branchId" className="flab">Cabang aktif *</label>
        <select id="branchId" className="fi" name="branchId" required defaultValue={shift?.branch_id ?? ""}>
          <option value="" disabled>Pilih cabang tempat bertugas</option>
          {canViewAll && <option value={ALL_BRANCHES} disabled={!!shift}>Semua cabang</option>}
          {branches.map(branch => <option key={branch.id} value={branch.id} disabled={!!shift && shift.branch_id !== branch.id}>{branch.code} · {branch.name}</option>)}
        </select>
        <SubmitButton className="btn-acc" pendingText="Memilih cabang…">Lanjutkan</SubmitButton>
      </form> : !loadError && <p role="status">Belum ada cabang aktif yang dapat diakses. Hubungi admin untuk penugasan cabang.</p>}
      <Link href="/mulai" className="back-btn" style={{ marginTop: 16 }}>Kembali ke pilihan mode</Link>
    </div>
  </main>;
}
