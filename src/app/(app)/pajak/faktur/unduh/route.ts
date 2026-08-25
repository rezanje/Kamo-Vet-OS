// Unduhan berkas pajak satu masa. Dipisah jadi route sendiri karena isinya harus
// dibentuk di server (butuh akses data), bukan dirakit ulang di browser.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tarikPajakMasa } from "@/lib/faktur-pajak-server";
import { berkasCsv, namaBerkas } from "@/lib/faktur-pajak";

const MASA = /^\d{4}-\d{2}$/;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!me || !["OWNER", "ADMIN", "FINANCE"].includes(String(me.role))) {
    return NextResponse.json({ error: "Berkas pajak hanya untuk owner, admin, dan finance." }, { status: 403 });
  }

  const masa = new URL(req.url).searchParams.get("masa") ?? "";
  if (!MASA.test(masa)) return NextResponse.json({ error: "Masa harus format YYYY-MM." }, { status: 400 });

  const { keluaran, masukan } = await tarikPajakMasa(masa);
  // BOM di depan supaya Excel membaca huruf beraksen dengan benar saat file dibuka.
  const isi = "﻿" + berkasCsv(keluaran, masukan);

  return new NextResponse(isi, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${namaBerkas(masa)}"`,
      "cache-control": "no-store",
    },
  });
}
