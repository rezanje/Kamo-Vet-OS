import { AksiKomplain } from "@/components/komplain/AksiKomplain";
import { Galat, KepalaKomplain } from "@/components/komplain/KomplainUi";
import { RincianKomplain } from "@/components/komplain/RincianKomplain";
import { KomplainError, muatDetail, muatPilihan, periksaSesiKomplain } from "@/lib/komplain-server";
import { createClient } from "@/lib/supabase/server";

type Karyawan = { id: string; nama: string; jabatan: string | null };

// Rincian + penanganan satu komplain. Komplain yang bukan milik cabang/akun ini tidak dikirim database (pesan "tidak ditemukan").
export default async function KomplainRincianPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return <Galat pesan="Komplain Pelanggan belum diizinkan untuk akun ini." />;
  let detail: Awaited<ReturnType<typeof muatDetail>>;
  let pilihan: Awaited<ReturnType<typeof muatPilihan>>;
  try {
    detail = await muatDetail(supabase, id);
    pilihan = await muatPilihan(supabase, detail.komplain.cabang_id);
  } catch (e) {
    return <Galat pesan={e instanceof KomplainError ? e.message : "Komplain belum dapat dimuat. Muat ulang sebentar lagi."} />;
  }
  const [{ data: emp }, firma] = await Promise.all([
    supabase.from("employees").select("id, nama, jabatan").eq("status", "Aktif").is("trashed_at", null).order("nama").limit(1000),
    detail.berkas.length ? supabase.storage.from("dokumen").createSignedUrls(detail.berkas.map(b => b.path), 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const urlBerkas: Record<string, string> = {};
  for (const f of (firma.data ?? []) as { path: string | null; signedUrl: string }[]) if (f.path && f.signedUrl) urlBerkas[f.path] = f.signedUrl;
  const karyawan = ((emp ?? []) as Karyawan[]).map(e => ({ id: e.id, nama: e.nama, jabatan: e.jabatan }));
  return (
    <>
      <KepalaKomplain aktif={null} judul="Komplain Pelanggan" catatanUang />
      <RincianKomplain detail={detail} urlBerkas={urlBerkas} />
      <AksiKomplain detail={detail} pilihan={pilihan} karyawan={karyawan} />
    </>
  );
}
