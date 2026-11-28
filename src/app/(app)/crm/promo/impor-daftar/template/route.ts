import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { makePromoMasterTemplate } from "@/lib/promo-master-excel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const { data: me } = await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!me?.is_active || !["OWNER", "ADMIN"].includes(me.role)) {
    return NextResponse.json({ error: "Akses format daftar promo tidak diizinkan" }, { status: 403 });
  }
  // Kode cabang ikut dicetak di sheet Petunjuk supaya pengisi tidak menebak.
  const branches = await readCompleteList<{ code: string | null; name: string; id: string }>((from, to) => db.from("branches")
    .select("id,code,name", { count: "exact" }).eq("is_active", true).order("id").range(from, to),
  "Cabang format promo", { maxRows: null });
  return new NextResponse(await makePromoMasterTemplate(branches) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Format-Daftar-Promo-VetOS.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
