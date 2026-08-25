"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockOut } from "@/lib/inventory";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { hitungKomisi, isChannel, isMarketplace, totalOnline } from "@/lib/online";
import { formatDokumen, formatNomor, urutanBerikutnya } from "@/lib/no-dokumen";

const BACK = "/penjualan/online";
const POIN_PER_RUPIAH = 1000; // earn: 1 poin / Rp1.000 (sama dengan POS)
const MAX_NO_STRUK_ATTEMPTS = 4; // count+1, count+2, count+3, lalu count+1 + suffix acak (last resort)

// Duplikat kecil dari src/app/me/actions.ts (house style — bukan modul bersama baru).
// Server Vercel jalan di UTC tapi bisnisnya WIB (UTC+7); "hari ini" harus dihitung WIB
// supaya operator jam 00:00–07:00 WIB tidak ditolak "tanggal masa depan" (I2).
function todayJakarta(): string {
  // WIB (UTC+7) date string YYYY-MM-DD.
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

type ItemInput = { item_id: string; nama: string; qty: number; harga: number };

// Order online: TANPA shift kasir (shift_id null) — settlement bukan tunai fisik.
// Marketplace → Dr 1202 Piutang Marketplace; WA → Dr 1102 Bank (lunas seketika).
export async function buatPenjualanOnline(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const fail = (msg: string) => redirect(`${BACK}/baru?error=${encodeURIComponent(msg)}`);

  const channel = String(formData.get("channel") ?? "");
  if (!isChannel(channel)) fail("Pilih channel penjualan yang valid.");

  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!warehouseId) fail("Pilih gudang online.");

  const buyerName = String(formData.get("buyer_name") ?? "").trim() || null;
  const externalRef = String(formData.get("external_ref") ?? "").trim() || null;
  // Marketplace tidak masuk CRM/poin (keputusan spec); hanya WA yang boleh link pelanggan.
  const customerId = channel === "WA" ? (String(formData.get("customer_id") ?? "") || null) : null;

  // tanggal dipakai untuk jurnal (uang) & nomor dokumen — validasi ketat (C2).
  // Default & pembanding "hari ini" pakai WIB (todayJakarta), bukan UTC — server Vercel
  // jalan di UTC dan selisih 7 jam itu menolak order sah / salah tanggal blank-date (I2).
  const tanggalRaw = String(formData.get("tanggal") ?? "").trim();
  const tanggal = tanggalRaw || todayJakarta();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail("Format tanggal tidak valid.");
  // Konvensi tanggal (M1): `d` diparse sebagai LOCAL midnight (bukan UTC); created_at
  // di bawah disimpan eksplisit sebagai WIB midday (+07:00) supaya instant tetap terbaca
  // sebagai `tanggal` di UTC maupun WIB. Nomor struknya sendiri memakai string `tanggal`
  // apa adanya, jadi tidak bergantung zona waktu server sama sekali.
  const d = new Date(`${tanggal}T00:00:00`);
  if (Number.isNaN(d.getTime())) fail("Tanggal tidak valid.");
  const todayStr = todayJakarta();
  if (tanggal > todayStr) fail("Tanggal tidak boleh di masa depan.");

  // Periode terkunci (tutup buku) tidak boleh kebobolan — kalau tidak dicek di sini,
  // postJournal akan gagal diam-diam (trigger DB raise, error ditelan) padahal stok/piutang sudah tercatat.
  const { data: lock, error: lockErr } = await supabase
    .from("accounting_locks").select("closed_until").eq("id", true).maybeSingle();
  if (lockErr) {
    // Fail closed (M3a): kalau status tutup buku tidak terbaca, jangan diam-diam
    // anggap periode terbuka — itu justru lubang buat guard uang ini.
    console.error("[buatPenjualanOnline] gagal baca status tutup buku:", lockErr);
    fail("Gagal memeriksa status tutup buku, coba lagi.");
  }
  if (lock?.closed_until && tanggal <= lock.closed_until) {
    fail(`Periode akuntansi s/d ${lock.closed_until} sudah ditutup — tidak bisa posting tanggal ini.`);
  }

  // Parse & validasi setiap baris barang SEBELUM insert sales — baris cacat ditolak
  // seluruhnya (bukan didiamkan/di-drop), supaya tidak ada sales yatim tanpa sale_items (C1).
  let parsed: unknown;
  try { parsed = JSON.parse(String(formData.get("items") ?? "[]")); } catch { parsed = []; }
  if (!Array.isArray(parsed)) fail("Data barang tidak valid.");

  const items: ItemInput[] = [];
  for (const raw of parsed as unknown[]) {
    if (!raw || typeof raw !== "object") fail("Ada baris barang dengan format tidak valid.");
    const row = raw as Record<string, unknown>;
    const itemId = String(row.item_id ?? "").trim();
    const nama = String(row.nama ?? "").trim();
    const qty = Number(row.qty);
    const harga = Number(row.harga);
    if (!itemId) fail("Ada baris barang tanpa referensi item.");
    if (!nama) fail("Ada baris barang tanpa nama.");
    if (!Number.isFinite(harga) || harga < 0) fail("Harga barang harus angka dan tidak boleh negatif.");
    if (!Number.isInteger(qty) || qty <= 0) fail("Qty barang harus bilangan bulat positif.");
    items.push({ item_id: itemId, nama, qty, harga });
  }
  if (items.length === 0) fail("Minimal 1 barang.");

  // Gudang online menentukan cabang (sales.branch_id NOT NULL).
  const { data: wh, error: whErr } = await supabase
    .from("warehouses").select("id, branch_id")
    .eq("id", warehouseId).eq("type", "ONLINE").eq("is_active", true).maybeSingle();
  if (whErr) console.error("[buatPenjualanOnline] gagal query gudang (RLS?):", whErr);
  if (whErr || !wh) fail("Gudang online tidak ditemukan atau tidak aktif.");
  const branchId = wh!.branch_id;

  const total = totalOnline(items);
  if (total <= 0) fail("Total order harus lebih dari nol.");

  // Formatnya dibaca dari master penomoran; bawaannya ONL-YYYYMMDD-NNNN.
  const { prefix: prefixOnl, digit: digitOnl } = await formatDokumen(supabase, "ONL", tanggal);
  const seq = await urutanBerikutnya(supabase, {
    table: "sales", column: "no_struk", prefix: prefixOnl, pad: digitOnl,
  });

  const marketplace = isMarketplace(channel);
  const poinEarned = customerId ? Math.floor(total / POIN_PER_RUPIAH) : 0;

  // Nomor tetap bisa race di request paralel; unique constraint jadi backstop —
  // kalau tabrakan (23505), coba lagi dengan nomor berikutnya, sama seperti postJournal.
  // MAX_NO_STRUK_ATTEMPTS - 1 nomor berurutan, lalu last resort dengan suffix acak —
  // total persis MAX_NO_STRUK_ATTEMPTS percobaan (M2).
  const noStrukCandidates = Array.from(
    { length: MAX_NO_STRUK_ATTEMPTS - 1 },
    (_, i) => formatNomor(prefixOnl, seq + i, digitOnl),
  );
  noStrukCandidates.push(
    `${formatNomor(prefixOnl, seq, digitOnl)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  );

  let sale: { id: string } | null = null;
  let noStruk = "";
  let saleErr: { code?: string; message: string } | null = null;
  for (const candidate of noStrukCandidates) {
    const res = await supabase
      .from("sales")
      .insert({
        branch_id: branchId, customer_id: customerId, no_struk: candidate,
        subtotal: total, discount: 0, total,
        metode_bayar: channel, bayar: total, kembali: 0,
        poin_earned: poinEarned, cashier_id: user?.id ?? null,
        channel, external_ref: externalRef, buyer_name: buyerName,
        marketplace_status: marketplace ? "piutang" : null,
        created_at: `${tanggal}T12:00:00+07:00`,
      })
      .select("id").single();
    if (res.data) { sale = res.data; noStruk = candidate; saleErr = null; break; }
    saleErr = res.error;
    if (res.error?.code !== "23505") break; // error lain: jangan retry
  }
  if (saleErr || !sale) {
    console.error("[buatPenjualanOnline] gagal simpan order:", saleErr);
    fail(saleErr?.code === "23505" ? "Nomor order bentrok, silakan coba simpan ulang." : "Gagal simpan order online.");
  }

  const { error: itErr } = await supabase.from("sale_items").insert(
    items.map((l) => ({
      sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga,
    })),
  );
  if (itErr) {
    // Defense in depth: baris sudah divalidasi (C1) tapi kalau insert tetap gagal
    // (mis. FK/RLS), jangan tinggalkan sales yatim tanpa sale_items.
    const { error: cleanupErr } = await supabase.from("sales").delete().eq("id", sale!.id);
    if (cleanupErr) {
      // Cleanup gagal itu sendiri harus kelihatan (M3b) — bukan cuma didiamkan —
      // supaya baris sales yatim yang tersisa bisa dicek manual.
      console.error("[buatPenjualanOnline] gagal hapus sales yatim (orphan tersisa):", cleanupErr);
    }
    console.error("[buatPenjualanOnline] gagal simpan sale_items, sales dihapus:", itErr);
    fail("Gagal simpan barang order online.");
  }

  // Stok gudang online berkurang lewat FIFO — cost jadi HPP riil (PRD §10.2).
  let hppFifo = 0;
  for (const l of items) {
    const { cost } = await stockOut(supabase, {
      warehouseId, itemId: l.item_id, qty: l.qty, source: "sale-online", ref: noStruk,
    });
    hppFifo += cost;
  }

  // Poin & tier hanya untuk order WA yang dilink ke pelanggan.
  if (customerId && poinEarned > 0) {
    const { data: cust } = await supabase
      .from("customers").select("points").eq("id", customerId).maybeSingle();
    const saldo = (cust?.points ?? 0) + poinEarned;
    await supabase.from("point_ledger").insert({
      customer_id: customerId, delta: poinEarned, saldo, ref: noStruk,
      description: `Penjualan online ${noStruk}`,
    });
    await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
    await recomputeCustomerTier(supabase, customerId);
  }

  // Jurnal pendapatan. Marketplace ditahan platform → piutang; WA langsung ke bank.
  const debitCode = marketplace ? "1202" : await kodeAkunBayar(supabase, "Transfer", branchId);
  const { dpp, ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  await postJournal(supabase, {
    tanggal, deskripsi: `Penjualan online ${channel} ${noStruk}`,
    source: "sale-online", sourceRef: noStruk, branchId,
    lines: [
      { code: debitCode, debit: total, credit: 0 },
      { code: "4101", debit: 0, credit: dpp },
      ...(ppn > 0 ? [{ code: "2201", debit: 0, credit: ppn }] : []),
    ],
  });

  // HPP = cost FIFO riil dari layer yang terkonsumsi.
  if (hppFifo > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: `HPP penjualan online ${noStruk}`,
      source: "sale-online-hpp", sourceRef: noStruk, branchId,
      lines: [
        { code: "5101", debit: hppFifo, credit: 0 },
        { code: "1301", debit: 0, credit: hppFifo },
      ],
    });
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Order ${noStruk} tersimpan.`)}`);
}

// Pencairan marketplace: input dana yang benar-benar masuk bank; selisihnya = komisi platform.
// ponytail: 1 order = 1 pencairan. Kalau volume naik dan platform mencairkan
// banyak order sekaligus, naikkan ke pencairan batch (tabel disbursements).
export async function tandaiCair(formData: FormData) {
  const supabase = await createClient();
  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const saleId = String(formData.get("sale_id") ?? "");
  const nominal = Number(formData.get("nominal")) || 0;
  if (!saleId) fail("Order tidak dikenali.");
  if (nominal <= 0) fail("Nominal pencairan harus lebih dari nol.");

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, total, channel, marketplace_status, branch_id")
    .eq("id", saleId).maybeSingle();
  if (!sale) fail("Order tidak ditemukan.");
  if (!sale!.channel || !isMarketplace(sale!.channel)) fail("Order ini bukan order marketplace.");
  if (sale!.marketplace_status !== "piutang") fail("Order ini sudah dicairkan.");

  const total = Number(sale!.total);
  // Nominal jauh di atas total = kemungkinan besar salah ketik; jangan diam-diam diclamp (I1).
  if (nominal > total) fail("Nominal pencairan tidak boleh melebihi total order.");
  const komisi = hitungKomisi(total, nominal);
  const now = new Date();
  const tanggal = todayJakarta();

  // Periode terkunci (tutup buku) — sama seperti buatPenjualanOnline (I1). Kalau tidak
  // dicek di sini, UPDATE sales di bawah tetap sukses (marketplace_status='cair' tercatat)
  // tapi jurnal pencairan gagal diam-diam (trigger DB raise, postJournal menelan error),
  // dan tidak bisa diretry karena predikat marketplace_status='piutang' sudah tidak match.
  const { data: lock, error: lockErr } = await supabase
    .from("accounting_locks").select("closed_until").eq("id", true).maybeSingle();
  if (lockErr) {
    console.error("[tandaiCair] gagal baca status tutup buku:", lockErr);
    fail("Gagal memeriksa status tutup buku, coba lagi.");
  }
  if (lock?.closed_until && tanggal <= lock.closed_until) {
    fail(`Periode akuntansi s/d ${lock.closed_until} sudah ditutup — tidak bisa posting tanggal ini.`);
  }

  // Guard double-submit (C3): predikat marketplace_status ada di UPDATE itu sendiri,
  // bukan cuma di baca sebelumnya. Kalau 0 baris ke-update, order sudah dicairkan duluan
  // oleh submit lain — jangan lanjut posting jurnal kedua kalinya.
  const { data: updated, error: updErr } = await supabase
    .from("sales")
    .update({ marketplace_status: "cair", komisi, disbursed_at: now.toISOString() })
    .eq("id", saleId)
    .eq("marketplace_status", "piutang")
    .select("id");
  if (updErr) {
    console.error("[tandaiCair] gagal update sales:", updErr);
    fail("Gagal mencatat pencairan.");
  }
  if (!updated || updated.length === 0) fail("Order ini sudah dicairkan.");

  // Dr Bank (dana masuk) + Dr Beban Komisi (potongan platform) / Cr Piutang Marketplace (nilai order).
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pencairan ${sale!.channel} ${sale!.no_struk}`,
    source: "sale-online-cair", sourceRef: sale!.no_struk, branchId: sale!.branch_id,
    lines: [
      { code: await kodeAkunBayar(supabase, "Transfer", sale!.branch_id), debit: Math.min(nominal, total), credit: 0 },
      ...(komisi > 0 ? [{ code: "5305", debit: komisi, credit: 0 }] : []),
      { code: "1202", debit: 0, credit: total },
    ],
  });

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Pencairan ${sale!.no_struk} tercatat.`)}`);
}
