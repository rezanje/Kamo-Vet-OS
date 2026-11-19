"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { bacaTanggalEfektif, perluAlasanTanggal } from "@/lib/tanggal-efektif-petshop";
import type { ActionRejection } from "@/components/LocalTransactionDraft";
import { susunUbahStruk, type IsianUbah } from "@/lib/ubah-struk";
import { bacaJalurOwnerBelumDibayar, loadKatalogUntuk, loadStrukUbah } from "@/lib/ubah-struk-server";

function correctionMoney(value: FormDataEntryValue | null): number {
  // A blank Tunai/Transfer box means nothing was paid that way.
  // A missing field is still rejected; the RPC re-checks that the split equals the bill.
  const text = typeof value === "string" ? value.trim() || "0" : "";
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) throw new Error("Jumlah koreksi tidak valid. Isi angka Rupiah dengan maksimal dua desimal.");
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount > 1_000_000_000_000 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("Jumlah koreksi tidak valid. Muat ulang lalu coba lagi.");
  }
  return amount;
}

/**
 * Galat database ber-SQLSTATE berarti transaksi RPC sudah dibatalkan utuh (tidak ada yang tersimpan), jadi alasannya aman
 * ditampilkan apa adanya. Melempar galat justru disembunyikan Next.js di produksi dan tampil sebagai "respons belum terkonfirmasi".
 * Galat tanpa SQLSTATE (jaringan putus, dsb.) tetap dilempar: hasilnya belum pasti.
 */
function rpcRefusal(error: { code?: string; message?: string } | null, petunjukBatalUbah = false): ActionRejection | null {
  const code = error?.code ?? "";
  if (!/^[0-9A-Z]{5}$/.test(code) || !error?.message) return null;
  const retry = code.startsWith("40") || code === "55P03" || code === "57014";
  const message = petunjukBatalUbah ? petunjukHadiahStaf(error.message) : error.message;
  return { ok: false, outcome: retry ? "retry" : "rejected", message: retry ? `${message}. Coba simpan lagi sebentar lagi.` : message };
}

/**
 * Batalkan penjualan / Ubah transaksi membalik hadiah staf kasir (poin, rangkaian, misi) dan HANYA bisa dari transaksi kasir yang terakhir
 * (urutan wajib, kalau tidak hadiah transaksi sesudahnya ikut terhapus). Kasir yang sudah jualan lagi menabrak penjaga ini: database
 * menolak seluruhnya (tidak ada yang tersimpan). Pesan database memakai istilah dalam; ganti dengan langkah yang bisa dikerjakan Owner.
 */
function petunjukHadiahStaf(message: string): string {
  if (!/Transaksi staf berikutnya masih aktif|hadiah staf|aktivitas staf/i.test(message)) return message;
  return "Struk ini tidak bisa dibatalkan atau diubah sekarang: kasir yang sama sudah membuat transaksi sesudahnya, dan hadiah staf harus dibalik berurutan. "
    + "Tidak ada yang berubah. Jika struk sedang belum dibayar, klik Terima pembayaran satu kali agar kembali Lunas. Untuk menambah barang, catat sebagai transaksi baru di Kasir.";
}

export async function koreksiMetodePembayaran(form: FormData): Promise<void | ActionRejection> {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  const cash = correctionMoney(form.get("tunai"));
  const transfer = correctionMoney(form.get("transfer"));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0
    || !key.trim() || key.length > 120 || reason.length < 3 || reason.length > 1000) {
    throw new Error("Identitas atau alasan koreksi tidak valid. Muat ulang lalu coba lagi.");
  }
  const db = await createClient();
  const { data, error } = await db.rpc("correct_pos_sale_payment", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason,
    p_cash_amount: cash, p_transfer_amount: transfer,
  });
  const refusal = rpcRefusal(error);
  if (refusal) return refusal;
  if (error || data?.sale_id !== id || data?.revision !== revision + 1 || !data?.audit_id) {
    throw new Error(error?.message ?? "Hasil koreksi belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  redirect(`/penjualan/${id}?success=payment-corrected&draft_scope=${encodeURIComponent(`sale-payment:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

export async function batalkanPenjualan(form: FormData): Promise<void | ActionRejection> {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0 || !key || reason.length < 3 || reason.length > 1000) {
    throw new Error("Identitas atau alasan pembatalan tidak lengkap. Muat ulang lalu coba lagi.");
  }
  const db = await createClient();
  const { data, error } = await db.rpc("cancel_posted_sale", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason,
  });
  const refusal = rpcRefusal(error, true);
  if (refusal) return refusal;
  if (error || !data?.voided) throw new Error(error?.message ?? "Hasil pembatalan belum terkonfirmasi. Coba ulang dengan formulir yang sama.");
  revalidatePath("/", "layout");
  // A replacement is a fresh checkout with its own reviewed price/payment.
  if (form.get("tindakan") === "ganti") {
    const { data: sale, error: readError } = await db.from("sales").select("channel").eq("id", id).single();
    if (readError || !sale) throw new Error("Pembatalan tersimpan. Buka kembali riwayat penjualan untuk membuat pengganti.");
    redirect(`${sale.channel ? "/penjualan/online/baru" : "/kasir"}?replace_sale=${encodeURIComponent(id)}`);
  }
  redirect(`/penjualan/${id}?success=cancelled&draft_scope=${encodeURIComponent(`sale-cancel:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/** Penanda di alamat hanya bila jurnal dibukukan di tanggal sebelum hari ini (supaya banner bisa menyebutnya). */
function tglParam(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value < hariIniWIB() ? `&tgl=${value}` : "";
}

const SALE_METHODS = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

function receiptFields(form: FormData) {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0 || !key.trim() || key.length > 120) {
    throw new Error("Identitas penjualan tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }
  return { id, revision, key, reason };
}

/** Batalkan penerimaan (gaya Accurate): uang hilang dari kas/bank, struk menjadi belum dibayar. Hanya Owner (atau peran yang dicentang Owner). */
export async function batalkanPenerimaan(form: FormData): Promise<void | ActionRejection> {
  const { id, revision, key, reason } = receiptFields(form);
  if (reason.length < 3 || reason.length > 1000) throw new Error("Isi alasan membatalkan penerimaan (minimal 3 huruf).");
  if (form.get("konfirmasi") !== "ya") throw new Error("Centang kotak konfirmasi dulu: uang pembayaran akan dikeluarkan dari kas/bank dan struk menjadi belum dibayar.");
  // Tanggal efektif (kosong = hari ini). Sebelum hari ini hanya Owner/peran berizin; database yang memutuskan.
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  const db = await createClient();
  const { data, error } = await db.rpc("cancel_pos_sale_receipt", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason, p_effective_date: tanggal,
  });
  const refusal = rpcRefusal(error);
  if (refusal) return refusal;
  if (error || data?.sale_id !== id || data?.unpaid !== true || !data?.cancellation_id) {
    throw new Error(error?.message ?? "Hasil pembatalan penerimaan belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  // Efek laci jatuh di shift asal (terbuka), di shift terbuka PELAKU ("lain" dari shift asal), atau tidak di laci mana pun ("tanpa": ada uang tunai tetapi pelaku tanpa shift terbuka).
  const other = data.effect_in_other_shift === true ? "&shift=lain" : data.shift_mode === "tanpa_shift" ? "&shift=tanpa" : "";
  redirect(`/penjualan/${id}?success=receipt-cancelled${other}${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-receipt-cancel:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/** Terima pembayaran lagi sesudah penerimaan dibatalkan: metode boleh diganti, jumlahnya harus sama dengan total struk. */
export async function terimaPembayaranUlang(form: FormData): Promise<void | ActionRejection> {
  const { id, revision, key, reason } = receiptFields(form);
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  if (perluAlasanTanggal(tanggal) && (reason.length < 3 || reason.length > 1000)) throw new Error("Isi alasan mengubah tanggal (minimal 3 huruf).");
  const plan = SALE_METHODS.flatMap(method => {
    const raw = form.get(`amount_${method}`);
    const amount = raw === null ? 0 : correctionMoney(raw); // kolom yang tidak dikirim = 0; basis data tetap memeriksa jumlah = total
    return amount > 0 ? [{ method, amount }] : [];
  });
  if (plan.length === 0) throw new Error("Isi jumlah pembayaran minimal satu metode.");
  const db = await createClient();
  const { data, error } = await db.rpc("receive_pos_sale_payment", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_plan: plan, p_effective_date: tanggal, p_reason: reason || null,
  });
  const refusal = rpcRefusal(error);
  if (refusal) return refusal;
  if (error || data?.sale_id !== id || data?.unpaid !== false || !data?.journal_id) {
    throw new Error(error?.message ?? "Hasil penerimaan pembayaran belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  const tanpa = data.shift_mode === "tanpa_shift" ? "&shift=tanpa" : "";
  redirect(`/penjualan/${id}?success=receipt-received${tanpa}${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-receipt-receive:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/**
 * Ubah pembayaran satu langkah (gaya Accurate, permintaan Anisa 19 Nov 2026): tanggal bayar + pembagian metode diubah langsung.
 * Database membalik penerimaan lama di tanggal aslinya dan mencatat yang baru di tanggal pilihan dalam SATU transaksi
 * (struk tidak pernah tertinggal "belum dibayar"). Kolom tanggal tidak dikirim = hari ini.
 */
export async function ubahPembayaran(form: FormData): Promise<void | ActionRejection> {
  const { id, revision, key, reason } = receiptFields(form);
  if (key.length > 110) throw new Error("Identitas simpan tidak valid. Muat ulang halaman lalu coba lagi.");
  if (reason.length < 3 || reason.length > 980) return { ok: false, outcome: "rejected", message: "Isi alasan perubahan (minimal 3 huruf)." };
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  let plan: { method: string; amount: number }[];
  try {
    plan = SALE_METHODS.flatMap(method => {
      const raw = form.get(`amount_${method}`);
      const amount = raw === null ? 0 : correctionMoney(raw);
      return amount > 0 ? [{ method, amount }] : [];
    });
  } catch (error) { return { ok: false, outcome: "rejected", message: error instanceof Error ? error.message : "Jumlah pembayaran tidak valid." }; }
  if (plan.length === 0) return { ok: false, outcome: "rejected", message: "Isi jumlah pembayaran minimal satu metode." };
  const db = await createClient();
  const { data, error } = await db.rpc("change_pos_sale_payment", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason, p_plan: plan, p_effective_date: tanggal,
  });
  const refusal = rpcRefusal(error);
  if (refusal) return refusal;
  if (error || data?.sale_id !== id || data?.unpaid !== false || data?.mode !== "ubah-pembayaran" || !data?.journal_id) {
    throw new Error(error?.message ?? "Hasil ubah pembayaran belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  redirect(`/penjualan/${id}?success=payment-changed${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-payment-edit:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/** Order marketplace: batalkan pencairan sehingga order kembali ke piutang marketplace (lalu bisa dicairkan ulang atau dibatalkan/diganti). */
export async function batalkanPencairan(form: FormData): Promise<void | ActionRejection> {
  const { id, revision, key, reason } = receiptFields(form);
  if (reason.length < 3 || reason.length > 1000) throw new Error("Isi alasan membatalkan pencairan (minimal 3 huruf).");
  if (form.get("konfirmasi") !== "ya") throw new Error("Centang kotak konfirmasi dulu: dana pencairan akan dikeluarkan dari bank dan order kembali menjadi piutang marketplace.");
  const tanggal = bacaTanggalEfektif(form.get("tanggal"));
  const db = await createClient();
  const { data, error } = await db.rpc("cancel_online_disbursement", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason, p_effective_date: tanggal,
  });
  const refusal = rpcRefusal(error);
  if (refusal) return refusal;
  if (error || data?.sale_id !== id || data?.status !== "piutang" || !data?.cancellation_id) {
    throw new Error(error?.message ?? "Hasil pembatalan pencairan belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  redirect(`/penjualan/${id}?success=disbursement-cancelled${tglParam(data.effective_date)}&draft_scope=${encodeURIComponent(`sale-disbursement-cancel:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}

/**
 * Ubah transaksi struk kasir (Owner/Finance): isi baru disusun dari struk lama di database + isian formulir, lalu satu RPC atomik
 * menutup struk lama dan membuat struk pengganti di TANGGAL ASLI (stok & HPP di hari ubah). Penolakan pasti dikembalikan sebagai pesan.
 */
export async function ubahTransaksi(form: FormData): Promise<void | ActionRejection> {
  const id = String(form.get("id") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  const tolak = (message: string): ActionRejection => ({ ok: false, outcome: "rejected", message });
  if (!/^[0-9a-f-]{36}$/i.test(id) || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0 || !key.trim() || key.length > 114) {
    return tolak("Identitas struk tidak lengkap. Muat ulang halaman lalu coba lagi.");
  }
  if (reason.length < 3 || reason.length > 1000) return tolak("Isi alasan perubahan (minimal 3 huruf).");
  let isian: IsianUbah;
  try { isian = JSON.parse(String(form.get("isian") ?? "")) as IsianUbah; }
  catch { return tolak("Isian perubahan tidak terbaca. Muat ulang halaman lalu coba lagi."); }
  const db = await createClient();
  const lama = await loadStrukUbah(db, id);
  if (!lama) return tolak("Struk tidak ditemukan.");
  if (lama.revision !== revision || lama.voided_at) return tolak("Struk sudah berubah atau sudah diubah. Muat ulang halaman sebelum mengubah lagi.");
  let payload;
  try {
    const katalog = await loadKatalogUntuk(db, [...lama.items.map(line => line.item_id ?? ""), ...(isian.lines ?? []).map(line => line.item_id)]);
    // Jalur Owner struk berpromo yang penerimaannya dibatalkan (migrasi 20261119100000): promo baris dihitung dari baris asal.
    const jalurOwnerBelumDibayar = await bacaJalurOwnerBelumDibayar(db, lama);
    payload = susunUbahStruk({ lama, isian, katalog, rupiahPerPoin: lama.rupiahPerPoin, jalurOwnerBelumDibayar });
  } catch (error) {
    return tolak(error instanceof Error ? error.message : "Isian perubahan tidak valid.");
  }
  const { data, error } = await db.rpc("edit_posted_pos_sale", {
    p_sale_id: id, p_expected_revision: revision, p_request_key: key, p_reason: reason, p_edit: payload,
  });
  const refusal = rpcRefusal(error, true);
  if (refusal) return refusal;
  if (error || data?.old_sale_id !== id || typeof data?.sale_id !== "string" || !data?.edit_id) {
    throw new Error(error?.message ?? "Hasil ubah transaksi belum terkonfirmasi. Periksa daftar penjualan sebelum menyimpan ulang.");
  }
  revalidatePath("/", "layout");
  redirect(`/penjualan/${data.sale_id}?success=edited&draft_scope=${encodeURIComponent(`sale-edit:${id}:${revision}`)}&draft_done=${encodeURIComponent(key)}`);
}
