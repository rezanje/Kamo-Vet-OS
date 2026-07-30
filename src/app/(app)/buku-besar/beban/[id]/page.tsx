import { PengeluaranDetail } from "@/components/pengeluaran/PengeluaranDetail";

// Jalur FINANCE ke bukti pengeluaran: sidebar mereka memuat Buku Besar,
// bukan modul Persediaan.
export default async function BebanDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  return (
    <PengeluaranDetail
      id={id}
      kembaliHref="/buku-besar/beban"
      kembaliLabel="Kembali ke Pencatatan Beban"
      success={success}
      error={error}
    />
  );
}
