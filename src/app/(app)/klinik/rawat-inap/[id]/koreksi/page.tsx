import { InpatientEntryPage } from "../InpatientEntryPage";

// A5 (meeting 12 Nov 2026): "Tambah koreksi visit" setelah pasien pulang/RIP — form Laporan Visit yang sama (tanpa obat/tagihan,
// tanpa ubah kondisi), alasan wajib. Hanya Owner atau pemegang izin "Koreksi visit rawat inap"; database memeriksa ulang.
export default async function Page(props: { params: Promise<{ id: string }>; searchParams?: Promise<{ error?: string; tab?: string }> }) {
  return InpatientEntryPage({ ...props, mode: "clinical", koreksi: true });
}
