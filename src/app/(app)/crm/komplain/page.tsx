import Link from "next/link";
import { HalamanKomplain, SaringanKomplain } from "@/components/komplain/DaftarKomplain";
import { Galat, KepalaKomplain } from "@/components/komplain/KomplainUi";
import { bacaFilter, tautanFilter } from "@/lib/komplain";
import { KomplainError, muatDaftar, muatPilihan, periksaSesiKomplain } from "@/lib/komplain-server";
import { createClient } from "@/lib/supabase/server";

// Daftar Komplain Pelanggan. Siapa melihat apa ditentukan database (RLS/RPC): OWNER/ADMIN/FINANCE semua cabang yang boleh diakses;
// STAFF/DOKTER hanya komplain cabangnya yang mereka buat atau ditugaskan kepada mereka.
export default async function KomplainDaftarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = bacaFilter(await searchParams);
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return <Galat pesan="Komplain Pelanggan belum diizinkan untuk akun ini." />;
  let data: [Awaited<ReturnType<typeof muatPilihan>>, Awaited<ReturnType<typeof muatDaftar>>];
  try {
    data = await Promise.all([muatPilihan(supabase, filter.cabang || null), muatDaftar(supabase, filter)]);
  } catch (e) {
    return <Galat pesan={e instanceof KomplainError ? e.message : "Daftar komplain belum dapat dimuat. Muat ulang sebentar lagi."} />;
  }
  const [pilihan, hasil] = data;
  return (
    <>
      <KepalaKomplain aktif="daftar" judul="Komplain Pelanggan" catatanUang />
      <SaringanKomplain filter={filter} pilihan={pilihan} aksi="/crm/komplain" urut />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 10px" }}>
        <Link href="/crm/komplain/baru" prefetch={false} className="btn-acc" style={{ textDecoration: "none" }}><i className="ti ti-plus" /> Catat komplain</Link>
        {hasil.total > 0 && <a href={tautanFilter("/crm/komplain/unduh", filter, { hal: 1 })} className="btn-def" style={{ textDecoration: "none" }}><i className="ti ti-file-spreadsheet" /> Unduh Excel</a>}
      </div>
      <HalamanKomplain filter={filter} hasil={hasil} path="/crm/komplain" />
    </>
  );
}
