"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";

const BASE = "/pos/penyesuaian";

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
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Hanya owner/admin yang bisa membuat penyesuaian persediaan")}`);
  }
  return supabase;
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

  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!requestKey || requestKey.length > 120) gagal("Kunci formulir tidak valid. Muat ulang halaman lalu coba lagi.");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // I02: dokumen, mutasi stok, dan jurnal 170001/720010 ditulis dalam SATU transaksi
  // database. Qty sistem dibaca ulang di bawah kunci stok (bukan dari layar), dan
  // kunci permintaan yang sama tidak pernah memposting dua kali.
  const { data, error } = await supabase.rpc("post_inventory_adjustment_atomic", {
    p_request_key: requestKey,
    p_warehouse_id: warehouseId,
    p_tanggal: tanggal,
    p_alasan: alasan,
    p_keterangan: keterangan,
    p_rows: baris,
  });
  const hasil = data as { adjustment_id?: string; no_adj?: string } | null;
  if (error || !hasil?.adjustment_id) gagal(error?.message ?? "Penyesuaian belum terkonfirmasi. Periksa daftar penyesuaian sebelum menyimpan ulang.");

  revalidatePath(BASE);
  revalidatePath("/pos/stok");
  redirect(`${BASE}/${hasil!.adjustment_id}?success=${encodeURIComponent(`Penyesuaian ${hasil!.no_adj} tersimpan — stok & jurnal sudah menyesuaikan.`)}${transactionDraftAck(formData)}`);
}
