import { HppReportPage } from "@/components/HppReportPage";
import type { ReportParams } from "@/lib/hpp-reports-server";
import { laporanDiminta } from "@/lib/report-gate";
export default async function Page({ searchParams }: { searchParams: Promise<ReportParams & { tampil?: string }> }) {
  const params = await searchParams;
  // A1 (meeting 12 Nov 2026): data baru ditarik setelah Tampilkan ditekan.
  return <HppReportPage kind="inventory" params={params} siap={laporanDiminta(params)} />;
}
