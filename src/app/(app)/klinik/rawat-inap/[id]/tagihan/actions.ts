"use server";
// Tagihan berjalan rawat inap: tagih tahap, terima pembayaran, batalkan kwitansi.
//
// Ketiganya hanya meneruskan ke RPC. Semua aturan uang (tagih-sekali, alokasi tertua
// lebih dulu, uang muka, uang muka minimal, shift, peran) ditegakkan di database —
// layar tidak boleh jadi satu-satunya penjaga.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { getPajakSettings, tambahPpn } from "@/lib/pajak";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { parseClinicPostingError } from "@/lib/klinik-posting";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { nilaiBarisResep, type BarisResep } from "@/lib/tagihan-berjalan";
import type { RanapPaymentState } from "@/lib/ranap-payment";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

const tidakPasti = "Hasil penyimpanan belum dapat dipastikan. Muat ulang dan periksa tagihan yang sudah tersimpan sebelum mencoba lagi.";

function kembali(recordId: string) {
  return `/klinik/rawat-inap/${recordId}/tagihan`;
}

async function shiftKlinik(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  const shift = user ? await getOpenShift(supabase as never, user.id, "klinik") : null;
  if (!shift) {
    redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses tagihan rawat inap")}`);
  }
  return shift;
}

/** Baris resep yang dipilih staf, diverifikasi ulang milik kunjungan ini dan belum ditagih. */
async function barisTerpilih(
  supabase: Awaited<ReturnType<typeof createClient>>, visitId: string, ids: string[],
): Promise<BarisResep[]> {
  const { data: mrs, error: mrError } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId);
  if (mrError) throw new Error("gagal-baca");
  const mrIds = ((mrs ?? []) as { id: string }[]).map((r) => r.id);
  if (!mrIds.length) return [];
  const { data, error } = await supabase
    .from("prescription_items")
    .select("id, nama_obat, qty, harga, jenis, kategori, item_id, satuan, compound_recipe_id")
    .in("medical_record_id", mrIds).in("id", ids).order("created_at");
  if (error) throw new Error("gagal-baca");
  return (data ?? []) as BarisResep[];
}

export async function tagihSekarang(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!recordId || !visitId) redirect("/klinik/rawat-inap?error=Rawat%20inap%20tidak%20valid");
  const back = kembali(recordId);
  if (!requestKey) redirect(`${back}?error=${encodeURIComponent("Kunci transaksi tidak valid. Muat ulang halaman lalu coba lagi.")}`);

  const shift = await shiftKlinik(supabase);
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("ids") ?? "[]"));
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string" && !!v);
  } catch { ids = []; }
  if (!ids.length) {
    redirect(`${back}?error=${encodeURIComponent("Pilih minimal satu baris yang mau ditagih sekarang.")}`);
  }

  let rows: BarisResep[];
  try { rows = await barisTerpilih(supabase, visitId, ids); }
  catch { redirect(`${back}?error=${encodeURIComponent("Rincian resep belum dapat dibaca. Muat ulang sebelum menagih.")}`); }
  if (rows.length !== ids.length) {
    redirect(`${back}?error=${encodeURIComponent("Ada baris yang sudah berubah atau bukan milik kunjungan ini. Muat ulang daftarnya.")}`);
  }

  const subtotal = rows.reduce((sum, r) => sum + nilaiBarisResep(r), 0);
  if (subtotal <= 0) {
    redirect(`${back}?error=${encodeURIComponent("Nilai tagihan nol — isi harga di rekam medis dulu.")}`);
  }
  const { tax, total } = tambahPpn(subtotal, await getPajakSettings(supabase));
  const alasan = String(formData.get("dp_override_reason") ?? "").trim();

  const { error } = await supabase.rpc("clinic_post_inpatient_stage_invoice", {
    p_visit_id: visitId,
    p_request_key: requestKey,
    p_invoice: {
      tanggal: hariIniWIB(), subtotal, discount: 0, tax, total,
      dp_amount: 0, dp_date: null, paid_status: "Belum Lunas", metode_bayar: "Tunai",
      shift_id: shift.id, voucher_code: null, salesperson_id: null,
      ...(alasan ? { dp_override_reason: alasan } : {}),
    },
    p_lines: rows.map((r) => ({
      description: r.nama_obat, qty: Number(r.qty), price: Number(r.harga) || 0,
      kind: r.jenis === "jasa" ? "jasa" : "obat",
      item_id: r.item_id ?? null, unit: r.satuan ?? null,
      prescription_item_id: r.id, recipe_id: r.compound_recipe_id ?? null,
      discount_percent: 0,
    })),
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error, tidakPasti))}`);
  revalidatePath(back);
  redirect(`${back}?success=tagih${transactionDraftAck(formData)}`);
}

export async function terimaPembayaran(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!recordId || !visitId) redirect("/klinik/rawat-inap?error=Rawat%20inap%20tidak%20valid");
  const back = kembali(recordId);
  if (!requestKey) redirect(`${back}?error=${encodeURIComponent("Kunci transaksi tidak valid. Muat ulang halaman lalu coba lagi.")}`);
  await shiftKlinik(supabase);
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  let parts: { method: string; amount: number }[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("parts") ?? "[]"));
    if (Array.isArray(parsed)) {
      parts = parsed.map((p) => ({
        method: String((p as { method?: unknown }).method ?? ""),
        amount: Number((p as { amount?: unknown }).amount) || 0,
      })).filter((p) => p.amount > 0);
    }
  } catch { parts = []; }
  if (!parts.length || parts.length > 6
      || parts.some((p) => !METODE_BAYAR.includes(p.method as (typeof METODE_BAYAR)[number])
        || !Number.isSafeInteger(p.amount))) {
    redirect(`${back}?error=${encodeURIComponent("Isi metode dan nominal rupiah bulat pada setiap bagian pembayaran (maksimal 6 bagian).")}`);
  }

  const invoiceId = String(formData.get("invoice_id") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const { error } = await supabase.rpc("clinic_receive_visit_payment", {
    p_visit_id: visitId, p_request_key: requestKey, p_tanggal: hariIniWIB(),
    p_parts: parts, p_invoice_id: invoiceId, p_catatan: catatan,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error, tidakPasti))}`);
  revalidatePath(back);
  redirect(`${back}?success=bayar${transactionDraftAck(formData)}`);
}

/** One write RPC. Its internal original stage + receipt calls share a transaction. */
export async function simpanBayar(formData: FormData): Promise<RanapPaymentState> {
  const recordId = String(formData.get("recordId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  const invalid = (): RanapPaymentState => ({ status: "ERROR", error: "Periksa metode, nominal rupiah bulat positif, dan kunci transaksi (maksimal 6 bagian)." });
  if (!recordId || !visitId || !requestKey || requestKey.length > 80) return invalid();
  let parts: { method: string; amount: number }[];
  try {
    const value: unknown = JSON.parse(String(formData.get("parts") ?? "[]"));
    if (!Array.isArray(value) || value.length > 6 || value.some(p => !p || typeof p !== "object"
      || !METODE_BAYAR.includes(p.method) || typeof p.amount !== "number" || !Number.isSafeInteger(p.amount) || p.amount <= 0)) return invalid();
    parts = value.map(p => ({ method: p.method, amount: p.amount }));
  } catch { return invalid(); }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "ERROR", error: "Sesi berakhir. Masuk lagi sebelum menyimpan pembayaran." };
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift) return { status: "ERROR", error: "Buka shift klinik sebelum menyimpan pembayaran." };
  const periode = await cekPeriode(supabase, hariIniWIB());
  if (periode) return { status: "ERROR", error: periode };
  const cashierDraft = formData.has("pending_snapshot");
  let draftRows: unknown[] = [];
  if (cashierDraft) {
    try {
      const value: unknown = JSON.parse(String(formData.get("pending_rows") ?? ""));
      if (!Array.isArray(value) || value.length > 200) return invalid();
      draftRows = value;
    } catch {return invalid();}
  }
  const { data, error } = await supabase.rpc(cashierDraft ? "clinic_save_inpatient_cashier" : "clinic_bill_and_pay_inpatient", {
    p_record_id: recordId, p_visit_id: visitId, p_request_key: requestKey, p_tanggal: hariIniWIB(), p_parts: parts,
    p_overpayment_ack: String(formData.get("overpayment_ack") ?? "").trim() || null,
    p_add_owner_credit: formData.get("add_owner_credit") === "true",
    p_dp_override_reason: String(formData.get("dp_override_reason") ?? "").trim() || null,
    ...(cashierDraft ? {p_snapshot:String(formData.get("pending_snapshot") ?? ""),p_rows:draftRows,p_reason:String(formData.get("cart_reason") ?? "").trim()} : {}),
  });
  if (error) return { status: "ERROR", error: parseClinicPostingError(error, tidakPasti) };
  if (data?.status === "OVERPAYMENT_CONFIRM_REQUIRED" && data.quote) return { status: "OVERPAYMENT_CONFIRM_REQUIRED", quote: data.quote };
  const applicationIds: string[] = Array.isArray(data?.application_ids) && data.application_ids.every((id: unknown) =>
    typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ? data.application_ids : [];
  if (data?.status !== "SAVED" || data.visit_id !== visitId || data.record_id !== recordId || (!data.receipt_id && !data.invoice_id && !applicationIds.length)) {
    return { status: "ERROR", error: tidakPasti };
  }
  const query = new URLSearchParams({ success: "transaksi" });
  if (data.receipt_id) query.set("receipt", data.receipt_id);
  if (data.invoice_id) query.set("invoice", data.invoice_id);
  if (applicationIds.length) query.set("applications", applicationIds.join(","));
  const back = cashierDraft ? `/klinik/pembayaran/${visitId}` : kembali(recordId);
  revalidatePath(back);
  revalidatePath(`/klinik/rekam-medis/${visitId}`);
  return { status: "SAVED", href: `${back}?${query}${transactionDraftAck(formData)}` };
}

export async function batalkanKwitansi(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const receiptId = String(formData.get("receiptId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!recordId) redirect("/klinik/rawat-inap?error=Rawat%20inap%20tidak%20valid");
  const back = kembali(recordId);
  if (!receiptId || !requestKey || !reason) {
    redirect(`${back}?error=${encodeURIComponent("Isi alasan pembatalan kwitansi lalu coba lagi.")}`);
  }
  await shiftKlinik(supabase);
  const { error } = await supabase.rpc("clinic_void_payment_receipt", {
    p_receipt_id: receiptId, p_request_key: requestKey, p_reason: reason,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error, tidakPasti))}`);
  revalidatePath(back);
  redirect(`${back}?success=batal${transactionDraftAck(formData)}`);
}

/**
 * Lepas pemakaian uang muka yang sudah menempel di tagihan (FIN-03).
 *
 * Ini SATU-SATUNYA jalan keluar yang sah untuk kwitansi ber-uang-muka yang salah:
 * peran keuangan, shift klinik aktif, alasan wajib, jurnal pembalik, dan jejaknya
 * dicatat database. Setelah ini kwitansinya baru bisa dibatalkan seperti biasa —
 * tanpa memulangkan pasien palsu dan tanpa menghapus baris resep.
 */
export async function lepaskanUangMuka(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const advanceId = String(formData.get("advanceId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!recordId) redirect("/klinik/rawat-inap?error=Rawat%20inap%20tidak%20valid");
  const back = kembali(recordId);
  if (!advanceId || !requestKey || !reason) {
    redirect(`${back}?error=${encodeURIComponent("Isi alasan melepas pemakaian uang muka lalu coba lagi.")}`);
  }
  await shiftKlinik(supabase);
  const { error } = await supabase.rpc("clinic_release_advance_application", {
    p_advance_id: advanceId, p_request_key: requestKey, p_reason: reason,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error, tidakPasti))}`);
  revalidatePath(back);
  redirect(`${back}?success=lepas${transactionDraftAck(formData)}`);
}
