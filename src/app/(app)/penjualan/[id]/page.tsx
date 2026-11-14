import { DetailPenjualan, type ParamDetailPenjualan } from "./DetailPenjualan";

export default async function PenjualanDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParamDetailPenjualan>;
}) {
  const { id } = await params;
  return DetailPenjualan({ id, sp: await searchParams });
}
