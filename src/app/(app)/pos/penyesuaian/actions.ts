"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { stockInAtBuyPrice, stockOut } from "@/lib/inventory";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";

const BASE = "/pos/penyesuaian";

const AKUN_PERSEDIAAN = "1301";
const AKUN_SELISIH = "5902";

// Berkas "use server" hanya boleh mengekspor fungsi async — daftar ini dipakai
// di dalam sini saja; labelnya untuk layar ada di halaman formulir.
const ALASAN = ["rusak", "hilang", "kadaluarsa", "temuan", "lainnya"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Penyesuaian menggeser nilai persediaan — sama kuncinya dengan produksi. */
async function assertBoleh(back: string): Promise<Db> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`${back}?error=${encodeURIComponent("Hanya owner/admin yang bisa membuat penyesuaian persediaan")}`);
  }
  return supabase;
}

async function nextNo(supabase: Db, tanggal: string): Promise<string> {
  const { nomor } = await nomorBerikutnya(supabase, "PS", tanggal, {
    table: "inventory_adjustments", column: "no_adj",
  });
  return nomor;
}

type BarisKiriman = { item_id: string; qty_baru: number };

export async function simpanPenyesuaian(formData: FormData) {
  const warehouseId = String(formData.get("warehouse_id") ?? "").trim();
  const back = warehouseId ? `${BASE}/baru?wh=${warehouseId}` : `${BASE}/baru`;
  const supabase = await assertBoleh(back);
  const gagal = (msg: string): never =>
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);

  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const alasan = String(formData.get("alasan") ?? "").trim();
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  let baris: BarisKiriman[] = [];
  try { baris = JSON.parse(String(formData.get("baris") ?? "[]")) as BarisKiriman[]; } catch { baris = []; }
  baris = baris
    .map((b) => ({ item_id: String(b.item_id ?? ""), qty_baru: Number(b.qty_baru) }))
    .filter((b) => b.item_id && Number.isFinite(b.qty_baru) && b.qty_baru >= 0);

  if (!warehouseId) gagal("Pilih gudangnya dulu");
  if (!(ALASAN as readonly string[]).includes(alasan)) gagal("Pilih alasan penyesuaiannya");
  if (baris.length === 0) gagal("Isi jumlah baru minimal untuk satu barang");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Qty sistem dibaca ULANG di server, bukan dipercaya dari layar: antara layar
  // dibuka dan tombol simpan ditekan, barangnya bisa saja sudah terjual.
  const { data: stokRows } = await supabase
    .from("stock").select("item_id, qty, items(name)")
    .eq("warehouse_id", warehouseId)
    .in("item_id", baris.map((b) => b.item_id));

  type StokRow = { item_id: string; qty: number; items: { name: string } | { name: string }[] | null };
  const stok = new Map(
    ((stokRows ?? []) as unknown as StokRow[]).map((s) => {
      const it = Array.isArray(s.items) ? s.items[0] : s.items;
      return [s.item_id, { qty: Number(s.qty), nama: it?.name ?? "Barang" }];
    }),
  );

  const efektif = baris
    .map((b) => {
      const now = stok.get(b.item_id);
      if (!now) return null;
      return { ...b, qty_sistem: now.qty, nama: now.nama, selisih: b.qty_baru - now.qty };
    })
    .filter((b): b is NonNullable<typeof b> => !!b && b.selisih !== 0);

  if (efektif.length === 0) gagal("Tidak ada selisih untuk disimpan — jumlah barunya sama dengan stok sistem");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: wh } = await supabase
    .from("warehouses").select("branch_id, name").eq("id", warehouseId).maybeSingle();

  const no = await nextNo(supabase, tanggal);
  const { data: doc, error } = await supabase
    .from("inventory_adjustments")
    .insert({
      no_adj: no, warehouse_id: warehouseId, tanggal, alasan, keterangan,
      created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !doc) gagal("Gagal membuat dokumen penyesuaian");

  let nilaiMasuk = 0;
  let nilaiKeluar = 0;
  for (const b of efektif) {
    let nilai = 0;
    if (b.selisih > 0) {
      const { data: item } = await supabase.from("items").select("buy_price").eq("id", b.item_id).maybeSingle();
      nilai = Math.round((Number(item?.buy_price) || 0) * b.selisih);
      await stockInAtBuyPrice(supabase, {
        warehouseId, itemId: b.item_id, qty: b.selisih, source: "penyesuaian", ref: no, tanggal,
      });
      nilaiMasuk += nilai;
    } else {
      // Nilai yang keluar = modal lapisan yang benar-benar terpakai, bukan harga
      // beli master yang bisa sudah basi.
      const { cost } = await stockOut(supabase, {
        warehouseId, itemId: b.item_id, qty: -b.selisih, source: "penyesuaian", ref: no,
      });
      nilai = Math.round(cost);
      nilaiKeluar += nilai;
    }

    await supabase.from("inventory_adjustment_items").insert({
      adjustment_id: doc!.id, item_id: b.item_id, nama: b.nama,
      qty_sistem: b.qty_sistem, qty_baru: b.qty_baru, selisih: b.selisih, nilai,
    });
  }

  await supabase.from("inventory_adjustments")
    .update({ nilai_masuk: nilaiMasuk, nilai_keluar: nilaiKeluar }).eq("id", doc!.id);

  // Lawannya 5902 Selisih Persediaan, bukan Hutang Usaha: tidak ada pemasok yang
  // menagih barang rusak. Dinilai MODAL — kerugiannya sebesar biaya perolehan.
  const lines = [
    ...(nilaiMasuk > 0
      ? [{ code: AKUN_PERSEDIAAN, debit: nilaiMasuk, credit: 0 }, { code: AKUN_SELISIH, debit: 0, credit: nilaiMasuk }]
      : []),
    ...(nilaiKeluar > 0
      ? [{ code: AKUN_SELISIH, debit: nilaiKeluar, credit: 0 }, { code: AKUN_PERSEDIAAN, debit: 0, credit: nilaiKeluar }]
      : []),
  ];
  if (lines.length > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Penyesuaian persediaan ${no} — ${alasan}${keterangan ? ` (${keterangan})` : ""} · ${wh?.name ?? ""}`.trim(),
      source: "penyesuaian",
      sourceRef: no,
      branchId: wh?.branch_id ?? null,
      lines,
    });
  }

  revalidatePath(BASE);
  revalidatePath("/pos/stok");
  redirect(`${BASE}/${doc!.id}?success=${encodeURIComponent(`Penyesuaian ${no} tersimpan — stok & jurnal sudah menyesuaikan.`)}`);
}
