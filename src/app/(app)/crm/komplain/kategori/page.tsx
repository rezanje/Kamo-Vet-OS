import { KategoriEditor } from "@/components/komplain/KategoriEditor";
import { Galat, KepalaKomplain } from "@/components/komplain/KomplainUi";
import { KomplainError, muatKategori, periksaSesiKomplain } from "@/lib/komplain-server";
import { createClient } from "@/lib/supabase/server";

export default async function KomplainKategoriPage() {
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return <Galat pesan="Komplain Pelanggan belum diizinkan untuk akun ini." />;
  let data: Awaited<ReturnType<typeof muatKategori>>;
  try {
    data = await muatKategori(supabase);
  } catch (e) {
    return <Galat pesan={e instanceof KomplainError ? e.message : "Kategori belum dapat dimuat. Muat ulang sebentar lagi."} />;
  }
  return (<><KepalaKomplain aktif="kategori" judul="Kategori & Pengaturan Komplain" /><KategoriEditor data={data} /></>);
}
