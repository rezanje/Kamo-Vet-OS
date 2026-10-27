import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buatTemplateSaldoAwalFaktur, TEMPLATE_SALDO_AWAL_FAKTUR } from "@/lib/saldo-awal-faktur";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const { data: me } = await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!me?.is_active || !["OWNER", "ADMIN", "FINANCE"].includes(me.role)) {
    return NextResponse.json({ error: "Akses format saldo awal tidak diizinkan" }, { status: 403 });
  }
  return new NextResponse(await buatTemplateSaldoAwalFaktur() as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${TEMPLATE_SALDO_AWAL_FAKTUR}"`,
      "Cache-Control": "no-store",
    },
  });
}
