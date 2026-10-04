import { assertRole } from "@/lib/master-guard";
import { loadAttendanceRecap } from "@/lib/attendance-recap-server";
import { buatExcelRekap } from "@/lib/attendance-recap";
export async function GET(request: Request) {
  const db = await assertRole("/me", "ekspor rekap absensi", [
    "OWNER",
    "ADMIN",
  ]);
  const url = new URL(request.url);
  try {
    const r = await loadAttendanceRecap(db, {
      periode: url.searchParams.get("periode") ?? undefined,
      cabang: url.searchParams.get("cabang") ?? undefined,
    });
    const bytes = await buatExcelRekap(r.result);
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rekap-absensi-${r.period}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Ekspor gagal dibuat" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
