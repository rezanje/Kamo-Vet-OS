"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { stockOut } from "@/lib/inventory";
import { cekPeriode } from "@/lib/jurnal-guard";
import { getPajakSettings, tambahPpn } from "@/lib/pajak";
import { bacaBaris, nextNoDokumen, totalBaris } from "@/lib/penjualan-server";
import { jurnalFakturJual, jurnalPengiriman, pesananSelesai, prefixFakturJual, sisaFaktur, sisaKirim } from "@/lib/penjualan-dokumen";
import { hariIniWIB } from "@/lib/tanggal";

const LIST = "/penjualan/pesanan";
const BOLEH = ["OWNER", "ADMIN", "FINANCE", "STAFF"];
const detail = (id: string) => `${LIST}/${id}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type BarisSO = {
  id: string; item_id: string | null; nama: string; satuan: string | null;
  qty: number; harga: number; qty_kirim: number; qty_faktur: number;
};

async function muatPesanan(supabase: Db, id: string) {
  const { data } = await supabase
    .from("sales_orders")
    .select("id, no_pesanan, customer_id, branch_id, warehouse_id, status, sales_order_items(id, item_id, nama, satuan, qty, harga, qty_kirim, qty_faktur)")
    .eq("id", id).maybeSingle();
  return data as (null | {
    id: string; no_pesanan: string; customer_id: string | null; branch_id: string | null;
    warehouse_id: string | null; status: string; sales_order_items: BarisSO[] | null;
  });
}

/** Angka per baris dari form: qty_<idBaris>. */
function qtyDariForm(formData: FormData, baris: BarisSO[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of baris) {
    const v = Number(formData.get(`qty_${b.id}`));
    out.set(b.id, Number.isFinite(v) && v > 0 ? v : 0);
  }
  return out;
}

export async function buatPesanan(formData: FormData) {
  const supabase = await assertRole(LIST, "pesanan penjualan", BOLEH);
  const gagal = (msg: string): never => redirect(`${LIST}?error=${encodeURIComponent(msg)}`);

  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const warehouseId = String(formData.get("warehouse_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const rencana = String(formData.get("rencana_kirim") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const baris = bacaBaris(formData.get("items"));
  if (!customerId) gagal("Pilih pelanggan dulu");
  if (baris.length === 0) gagal("Isi minimal satu baris barang atau jasa");

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "SO");

  const { data: so, error } = await supabase.from("sales_orders").insert({
    no_pesanan: no, customer_id: customerId, branch_id: branchId, warehouse_id: warehouseId,
    tanggal, rencana_kirim: rencana, total: totalBaris(baris), catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !so) gagal(error?.message ?? "Gagal menyimpan pesanan");

  const { error: itemErr } = await supabase.from("sales_order_items").insert(
    baris.map((b) => ({
      order_id: so!.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, qty: b.qty, harga: b.harga,
    })),
  );
  if (itemErr) {
    await supabase.from("sales_orders").delete().eq("id", so!.id);
    gagal(itemErr.message);
  }

  redirect(`${detail(so!.id)}?success=${encodeURIComponent(`Pesanan ${no} dibuat.`)}`);
}

export async function batalPesanan(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${detail(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(detail(id), "pesanan penjualan", BOLEH);

  const so = await muatPesanan(supabase, id);
  if (!so) gagal("Pesanan tidak ditemukan");
  const baris = so!.sales_order_items ?? [];
  // Pesanan yang barangnya sudah keluar gudang tidak boleh hilang begitu saja —
  // stok & jurnalnya sudah terlanjur bergerak.
  if (baris.some((b) => Number(b.qty_kirim) > 0)) gagal("Sebagian barang sudah dikirim — pesanan ini tidak bisa dibatalkan");

  await supabase.from("sales_orders").update({ status: "batal" }).eq("id", id);
  redirect(`${detail(id)}?success=${encodeURIComponent("Pesanan dibatalkan.")}`);
}

/**
 * Pengiriman: barang keluar gudang (FIFO), modalnya diakui sekarang.
 * Pendapatan menyusul di faktur — sengaja dipisah supaya barang terkirim yang
 * belum ditagih tetap kelihatan.
 */
export async function buatPengiriman(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${detail(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(detail(id), "pengiriman pesanan", BOLEH);

  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const ekspedisi = String(formData.get("ekspedisi") ?? "").trim() || null;
  const noResi = String(formData.get("no_resi") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const so = await muatPesanan(supabase, id);
  if (!so) gagal("Pesanan tidak ditemukan");
  if (so!.status === "batal") gagal("Pesanan ini sudah dibatalkan");

  // Gudang boleh ditentukan saat mengirim — pesanan yang lahir dari penawaran belum
  // punya gudang, dan tanpa ini barangnya keluar tanpa memotong stok mana pun.
  const gudang = String(formData.get("warehouse_id") ?? "").trim() || so!.warehouse_id;

  const baris = so!.sales_order_items ?? [];
  const diminta = qtyDariForm(formData, baris);
  const kirim = baris.map((b) => {
    const sisa = sisaKirim({ id: b.id, qty: Number(b.qty), qtyKirim: Number(b.qty_kirim), qtyFaktur: Number(b.qty_faktur), harga: Number(b.harga) });
    return { ...b, kali_ini: Math.min(diminta.get(b.id) ?? 0, sisa) };
  }).filter((b) => b.kali_ini > 0);

  if (kirim.length === 0) gagal("Tidak ada barang yang dikirim");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "DO");
  const { data: doc, error } = await supabase.from("sales_deliveries").insert({
    no_kirim: no, order_id: id, tanggal, ekspedisi, no_resi: noResi,
    catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !doc) gagal(error?.message ?? "Gagal menyimpan pengiriman");

  // Stok keluar FIFO. Baris tanpa master barang (jasa / ketikan bebas) tidak
  // memotong stok dan tidak punya modal.
  let totalHpp = 0;
  for (const b of kirim) {
    let hpp: number | null = null;
    if (b.item_id && gudang) {
      try {
        const { cost } = await stockOut(supabase, {
          warehouseId: gudang, itemId: b.item_id, qty: b.kali_ini,
          source: "sales-delivery", ref: no,
        });
        hpp = cost;
        totalHpp += cost;
      } catch (e) {
        console.error(`[stok] gagal potong stok ${no} item ${b.item_id}:`, e);
      }
    }

    await supabase.from("sales_delivery_items").insert({
      delivery_id: doc!.id, order_item_id: b.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, qty: b.kali_ini, hpp,
    });
    await supabase.from("sales_order_items")
      .update({ qty_kirim: Number(b.qty_kirim) + b.kali_ini }).eq("id", b.id);
  }

  if (totalHpp > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Pengiriman pesanan ${no} (${so!.no_pesanan})`,
      source: "sales-delivery",
      sourceRef: no,
      branchId: so!.branch_id,
      lines: jurnalPengiriman(totalHpp),
    });
  }

  if (so!.status === "draft") await supabase.from("sales_orders").update({ status: "diproses" }).eq("id", id);

  redirect(`${detail(id)}?success=${encodeURIComponent(`Pengiriman ${no} tercatat.`)}`);
}

/** Faktur penjualan: piutang lahir & pendapatan diakui. Dibatasi qty yang sudah dikirim. */
export async function buatFakturJual(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${detail(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(detail(id), "faktur penjualan", BOLEH);

  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const jatuhTempo = String(formData.get("jatuh_tempo") ?? "").trim() || tanggal;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const so = await muatPesanan(supabase, id);
  if (!so) gagal("Pesanan tidak ditemukan");
  if (so!.status === "batal") gagal("Pesanan ini sudah dibatalkan");
  if (jatuhTempo < tanggal) gagal("Jatuh tempo tidak boleh sebelum tanggal faktur");

  const baris = so!.sales_order_items ?? [];
  const diminta = qtyDariForm(formData, baris);
  const tagih = baris.map((b) => {
    const sisa = sisaFaktur({ id: b.id, qty: Number(b.qty), qtyKirim: Number(b.qty_kirim), qtyFaktur: Number(b.qty_faktur), harga: Number(b.harga) });
    return { ...b, kali_ini: Math.min(diminta.get(b.id) ?? 0, sisa) };
  }).filter((b) => b.kali_ini > 0);

  if (tagih.length === 0) gagal("Tidak ada barang yang bisa ditagih — kirim barangnya dulu");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Harga pesanan dianggap belum termasuk PPN — faktur menambahkan PPN di atasnya
  // kalau perusahaan sedang PKP, pola sama dengan tagihan klinik.
  const dpp = tagih.reduce((a, b) => a + b.kali_ini * Number(b.harga), 0);
  const { tax, total } = tambahPpn(dpp, await getPajakSettings(supabase));

  const { data: { user } } = await supabase.auth.getUser();

  // Seri nomor dipisah per unit bisnis: FJ untuk petshop, FJK untuk klinik
  // (permintaan Bu Nisa, meeting 14 Agustus) — supaya penjualan dua lini itu
  // tidak tercampur nomornya di buku penjualan.
  const { data: cab } = so!.branch_id
    ? await supabase.from("branches").select("type").eq("id", so!.branch_id).maybeSingle()
    : { data: null };
  const no = await nextNoDokumen(supabase, prefixFakturJual(cab?.type ?? null));
  const { data: inv, error } = await supabase.from("sales_invoices").insert({
    no_faktur: no, order_id: id, customer_id: so!.customer_id, branch_id: so!.branch_id,
    tanggal, jatuh_tempo: jatuhTempo, dpp, ppn: tax, total, catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !inv) gagal(error?.message ?? "Gagal menyimpan faktur");

  for (const b of tagih) {
    await supabase.from("sales_invoice_items").insert({
      invoice_id: inv!.id, order_item_id: b.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, qty: b.kali_ini, harga: b.harga,
    });
    await supabase.from("sales_order_items")
      .update({ qty_faktur: Number(b.qty_faktur) + b.kali_ini }).eq("id", b.id);
  }

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Faktur penjualan ${no} (${so!.no_pesanan})`,
    source: "sales-invoice",
    sourceRef: no,
    branchId: so!.branch_id,
    lines: jurnalFakturJual(dpp, tax),
  });

  // Pesanan tuntas kalau semua barisnya sudah terkirim & tertagih penuh.
  const sesudah = await muatPesanan(supabase, id);
  const barisBaru = (sesudah?.sales_order_items ?? []).map((b) => ({
    id: b.id, qty: Number(b.qty), qtyKirim: Number(b.qty_kirim), qtyFaktur: Number(b.qty_faktur), harga: Number(b.harga),
  }));
  await supabase.from("sales_orders")
    .update({ status: pesananSelesai(barisBaru) ? "selesai" : "diproses" }).eq("id", id);

  redirect(`${detail(id)}?success=${encodeURIComponent(`Faktur ${no} dibuat.`)}`);
}
