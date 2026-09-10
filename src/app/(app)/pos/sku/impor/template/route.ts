import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buatTemplateImporBarang, buatTemplateKategoriImporBarang } from "@/lib/template-impor-barang";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    return NextResponse.json({ error: "Akses impor tidak diizinkan" }, { status: 403 });
  }

  const isCategoryTemplate = new URL(request.url).searchParams.get("jenis") === "kategori";
  const workbook = isCategoryTemplate ? await buatTemplateKategoriImporBarang() : await buatTemplateImporBarang();
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": isCategoryTemplate
        ? 'attachment; filename="Format-Kategori-Subkategori-VetOS.xlsx"'
        : 'attachment; filename="Format-Impor-Barang-VetOS.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
