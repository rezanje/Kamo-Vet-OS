import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buatTemplateImporBarang } from "@/lib/template-impor-barang";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    return NextResponse.json({ error: "Akses impor tidak diizinkan" }, { status: 403 });
  }

  const workbook = await buatTemplateImporBarang();
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Format-Impor-VetOS.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
