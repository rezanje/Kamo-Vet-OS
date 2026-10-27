"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bacaWorkbookSaldoAwalFaktur, MAKS_BYTE_SALDO_AWAL_FAKTUR, rupiahBulat } from "@/lib/saldo-awal-faktur";
import type { OpeningInvoicePayload, OpeningInvoicePostResult, OpeningInvoicePreviewResult, OpeningInvoiceReceipt, OpeningInvoiceReport } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function actor(roles: string[], message: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sesi login kedaluwarsa.");
  const { data: profile, error } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.is_active || !roles.includes(profile.role)) throw new Error(message);
  return supabase;
}

const kontrol = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const n = rupiahBulat(text);
  if (n === null) throw new Error("Total kontrol harus rupiah bulat, misalnya 15.000.000.");
  return String(n);
};

/** Read the file and let the database validate every row; nothing is written. */
export async function periksaSaldoAwalFaktur(form: FormData): Promise<OpeningInvoicePreviewResult> {
  try {
    const supabase = await actor(["OWNER", "ADMIN", "FINANCE"], "Hanya OWNER/ADMIN/FINANCE aktif yang dapat memeriksa saldo awal per faktur.");
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Pilih file Excel .xlsx dari format saldo awal per faktur.");
    if (file.size > MAKS_BYTE_SALDO_AWAL_FAKTUR) throw new Error("File maksimal 2 MB.");
    const asOf = String(form.get("as_of") ?? "").trim();
    const branchId = String(form.get("branch_id") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Isi tanggal saldo awal (tanggal cutover).");
    if (!uuid.test(branchId)) throw new Error("Pilih cabang.");
    const parsed = await bacaWorkbookSaldoAwalFaktur(new Uint8Array(await file.arrayBuffer()));
    if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
    const payload: OpeningInvoicePayload = {
      source_name: file.name.slice(0, 200), as_of: asOf, branch_id: branchId,
      control: { hutang: kontrol(form.get("kontrol_hutang")), piutang: kontrol(form.get("kontrol_piutang")) },
      rows: parsed.rows,
    };
    const { data, error } = await supabase.rpc("preview_opening_invoices", { p_payload: payload });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Hasil pemeriksaan belum diterima. Coba periksa ulang.");
    return { ok: true, report: data as OpeningInvoiceReport, payload };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "File belum dapat diperiksa." };
  }
}

/** OWNER only. The RPC re-validates the same payload, binds it to the previewed hash and is idempotent. */
export async function postingSaldoAwalFaktur(input: { payload: OpeningInvoicePayload; expectedHash: string; reason: string; confirmed: boolean }): Promise<OpeningInvoicePostResult> {
  try {
    const supabase = await actor(["OWNER"], "Hanya OWNER aktif yang dapat memposting saldo awal per faktur.");
    const reason = String(input.reason ?? "").trim();
    if (!input.confirmed || reason.length < 10 || reason.length > 1000) throw new Error("Centang konfirmasi dan isi alasan audit 10–1.000 karakter.");
    if (!/^[0-9a-f]{64}$/.test(String(input.expectedHash ?? "")) || !input.payload || !Array.isArray(input.payload.rows)) throw new Error("Periksa file sebelum memposting.");
    const { data, error } = await supabase.rpc("post_opening_invoices", { p_payload: input.payload, p_expected_hash: input.expectedHash, p_reason: reason });
    if (error) throw new Error(error.message);
    if (!data?.batch_id || !data?.journal_id) throw new Error("Hasil posting belum terkonfirmasi. Periksa ulang file yang sama; sistem mencegah posting ganda.");
    for (const path of ["/keuangan/saldo-awal-faktur", "/keuangan/saldo-awal", "/keuangan/hutang", "/keuangan/piutang", "/keuangan/neraca", "/keuangan/buku-besar", "/pembelian/faktur", "/penjualan/faktur", "/pembelian/perintah-bayar"]) revalidatePath(path);
    return { ok: true, receipt: data as OpeningInvoiceReceipt };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Hasil posting belum dapat dipastikan. Periksa ulang file yang sama." };
  }
}
