import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompoundReport, loadInventoryReport, ReportAccessError, ReportInputError, type ReportKind } from "./hpp-reports-server";
import { compoundCsv, inventoryCsv } from "./hpp-reports-export";
import { hariIniWIB } from "./tanggal";

export function hppReportError(error: unknown): { status: number; message: string } {
  if (error instanceof ReportAccessError) return { status: error.status, message: error.message };
  if (error instanceof ReportInputError) return { status: 400, message: error.message };
  return { status: 500, message: "Laporan belum bisa dibaca lengkap. Coba lagi atau pilih cakupan lebih kecil." };
}
export async function downloadHppReport(client: SupabaseClient, kind: ReportKind, request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    let csv: string, filename: string;
    if (kind === "inventory") {
      csv = inventoryCsv(await loadInventoryReport(client,params));
      filename = `nilai-persediaan-${hariIniWIB()}.csv`;
    } else {
      const report = await loadCompoundReport(client,params);
      csv = compoundCsv(report);
      filename = `margin-racikan-${report.filters.dari}-${report.filters.sampai}.csv`;
    }
    return new Response(csv,{ headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
  } catch (error) {
    const failure = hppReportError(error);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
}
