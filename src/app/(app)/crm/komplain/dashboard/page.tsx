import { DashboardKomplain } from "@/components/komplain/DashboardKomplain";
import { SaringanKomplain } from "@/components/komplain/DaftarKomplain";
import { Galat, KepalaKomplain } from "@/components/komplain/KomplainUi";
import { bacaFilter, tautanFilter } from "@/lib/komplain";
import { KomplainError, muatDashboard, muatPilihan, periksaSesiKomplain } from "@/lib/komplain-server";
import { createClient } from "@/lib/supabase/server";

// Dashboard Komplain: angka dihitung satu fungsi database (komplain_dashboard) dengan hak yang sama seperti daftar.
export default async function KomplainDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = bacaFilter(await searchParams, { bulanIni: true });
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return <Galat pesan="Komplain Pelanggan belum diizinkan untuk akun ini." />;
  let hasil: [Awaited<ReturnType<typeof muatPilihan>>, Awaited<ReturnType<typeof muatDashboard>>];
  try {
    hasil = await Promise.all([muatPilihan(supabase, filter.cabang || null), muatDashboard(supabase, filter)]);
  } catch (e) {
    return <Galat pesan={e instanceof KomplainError ? e.message : "Dashboard komplain belum dapat dimuat. Muat ulang sebentar lagi."} />;
  }
  const [pilihan, data] = hasil;
  return (
    <>
      <KepalaKomplain aktif="dashboard" judul="Dashboard Komplain" />
      <SaringanKomplain filter={filter} pilihan={pilihan} aksi="/crm/komplain/dashboard" />
      <div style={{ margin: "0 0 10px" }}><a href={tautanFilter("/crm/komplain/unduh", filter, {})} className="btn-def" style={{ textDecoration: "none" }}><i className="ti ti-file-spreadsheet" /> Unduh Excel (sesuai saringan)</a></div>
      <DashboardKomplain d={data} filter={filter} />
    </>
  );
}
