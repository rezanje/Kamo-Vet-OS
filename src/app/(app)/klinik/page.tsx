import { headers } from "next/headers";
import { ALL_BRANCHES, BRANCH_HEADER } from "@/lib/operational-context";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { ModuleHome } from "@/components/ModuleHome";
import { StaffKlinikHome } from "@/components/StaffKlinikHome";
import { batasPerluDiingatkan, HARI_INGAT_DEFAULT } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";

type Klien = Awaited<ReturnType<typeof createClient>>;
/** Jumlah follow up cabang aktif yang perlu diingatkan (RLS membatasi ke cabang operasional). */
async function hitungFollowUpPerlu(supabase: Klien): Promise<number | null> {
  try {
    const { count, error } = await supabase.from("follow_ups").select("id", { count: "exact", head: true })
      .eq("status", "Menunggu").lte("tanggal", batasPerluDiingatkan(hariIniWIB(), HARI_INGAT_DEFAULT));
    return error ? null : count ?? 0;
  } catch {
    // Hitungan cuma penanda di kartu — gagal dibaca tidak boleh menahan layar klinik.
    return null;
  }
}

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).single();
  const shift = await getOpenShift(supabase, user.id, "klinik");

  // STAFF dapat layar sambutan klinik; admin/owner tetap tile-grid.
  if (profile?.role === "STAFF" && (await headers()).get(BRANCH_HEADER) !== ALL_BRANCHES) {
    if (!shift) redirect("/klinik/shift");
    return <StaffKlinikHome fullName={profile.full_name ?? "Staff"} followUpPerlu={await hitungFollowUpPerlu(supabase)} hariIngat={HARI_INGAT_DEFAULT} />;
  }

  return <>
    <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 700 }}>Shift kas klinik</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 4 }}>
          {shift ? "Shift kas Anda sedang berjalan. Tutup setelah selesai bertugas." : "Pemantauan klinik tidak membutuhkan shift. Mulai shift saat akan bertugas di kasir."}
        </div>
      </div>
      <Link href="/klinik/shift" className="btn-acc">{shift ? "Tutup shift klinik" : "Mulai shift klinik"}</Link>
    </div>
    <ModuleHome moduleId="klinik" />
  </>;
}
