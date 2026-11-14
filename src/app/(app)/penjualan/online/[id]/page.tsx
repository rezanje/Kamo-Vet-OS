import { DetailPenjualan, type ParamDetailPenjualan } from "../../[id]/DetailPenjualan";

// E3/3A (meeting 12 Nov 2026): detail order online di bawah sub-menu Penjualan Online, supaya akun
// "hanya Penjualan Online" bisa membuka pesanannya. Struk kasir (tanpa channel) tidak bisa dibuka di sini.
export default async function PenjualanOnlineDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParamDetailPenjualan>;
}) {
  const { id } = await params;
  return DetailPenjualan({ id, sp: await searchParams, online: true });
}
