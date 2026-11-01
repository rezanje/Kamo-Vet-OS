// Pencarian & pemuatan satu pelanggan untuk pemilih pelanggan (kasir, POS, form penjualan).
//
//   GET ?q=<nama/no HP>            -> { data: [{ id, name, phone }] }  (maks. 8)
//   GET ?id=<uuid>&untuk=dasar     -> { data: { id, name, phone } | null }
//   GET ?id=<uuid>&untuk=kasir     -> { data: CustRow | null }   (golongan, ulasan, ringkasan transaksi)
//   GET ?id=<uuid>&untuk=pos       -> { data: Cust | null }      (golongan, anabul)
//
// Menggantikan pola lama "muat semua 10.000+ pelanggan ke browser" yang membuat
// kasir lambat. RLS Supabase tetap berlaku karena memakai sesi pengguna.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cariPelangganDb, muatPelangganDasar, muatPelangganKasir, muatPelangganPos } from "@/lib/pelanggan-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TANPA_CACHE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi berakhir. Masuk lagi." }, { status: 401, headers: TANPA_CACHE });

  try {
    const id = params.get("id");
    if (id !== null) {
      if (!UUID.test(id)) return NextResponse.json({ data: null }, { headers: TANPA_CACHE });
      const untuk = params.get("untuk");
      const data = untuk === "kasir" ? await muatPelangganKasir(supabase, id)
        : untuk === "pos" ? await muatPelangganPos(supabase, id)
          : await muatPelangganDasar(supabase, id);
      return NextResponse.json({ data }, { headers: TANPA_CACHE });
    }
    const data = await cariPelangganDb(supabase, params.get("q") ?? "");
    return NextResponse.json({ data }, { headers: TANPA_CACHE });
  } catch {
    return NextResponse.json({ error: "Data pelanggan belum dapat dimuat. Coba lagi." }, { status: 503, headers: TANPA_CACHE });
  }
}
