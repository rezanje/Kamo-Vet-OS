import { HppReportPage } from "@/components/HppReportPage";
import type { ReportParams } from "@/lib/hpp-reports-server";
export default async function Page({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return <HppReportPage kind="compound" params={await searchParams} />;
}
