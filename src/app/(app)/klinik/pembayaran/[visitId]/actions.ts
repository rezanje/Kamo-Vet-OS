"use server";
import { parseStayType } from "@/lib/inpatient-stay";
import { quoteDemoPayments, type DemoFinancialPolicy } from "@/lib/clinic-demo-policy";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { resolveClinicSalesperson } from "@/lib/clinic-payment";
import type { ServicePerformersInput } from "@/lib/service-performers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPajakSettings, tambahPpn } from "@/lib/pajak";
import { getOpenShift } from "@/lib/shift";
import { bolehBayar, kategoriBerisiko } from "@/lib/tindakan";
import { bacaAturanConsent } from "@/lib/consent-server";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { bacaPoinPelanggan, catatPoinKlinik, catatPoinNota, poinTerpakai, RUPIAH_PER_POIN, type NotaPoin } from "@/lib/poin-klinik";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { bacaRombongan } from "@/lib/rombongan-server";
import { barisTagihanVisit, hitungPotonganKlinik, bagiPotongan, hargaNetto, nilaiBaris } from "@/lib/tagihan-klinik";
import { clinicServicePerformerInput, parseClinicPostingError, type ClinicInvoiceLineInput, type ClinicPostInvoiceParams } from "@/lib/klinik-posting";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher, type VoucherRow } from "@/lib/voucher";
import { bacaKodeKampanye, pesanGagalKampanye, pesanKampanyeDitolak } from "@/lib/kode-kampanye";
import { kirimStrukWa } from "@/lib/wa-engine";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { parseSplitPaymentDraft, validateSplitPaymentTotal, type ClinicSplitPayment } from "@/lib/clinic-split-payment";
import { isMissingRecordWrapper } from "@/lib/rekam-medis-susulan";

type Line = {
  deskripsi: string; qty: number; harga: number; jenis?: string; item_id?: string | null;
  satuan?: string | null; prescription_item_id?: string | null; recipe_id?: string | null;
  diskon_persen?: number;
  source_invoice_item_id?: string | null;
  service_performers?: ServicePerformersInput | null;
  salesperson_id?: string | null;
  /** H05: package origin of a component line (new invoices only; corrections inherit it). */
  package_item_id?: string | null;
  package_qty?: number | null;
};

/**
 * U07: start a read now, consume it later. The read is awaited at the exact point the
 * old sequential code awaited it, so every validation, redirect and error message keeps
 * its order, and a thrown/rejected read still rethrows there (before posting). A read
 * abandoned by an earlier redirect is ignored instead of surfacing as an unhandled
 * rejection. This does NOT inspect Supabase `{ error }` results: callers must check
 * those themselves before relying on the data.
 */
function mulai<T>(read: PromiseLike<T>): Promise<T> {
  const p = Promise.resolve(read);
  p.catch(() => undefined);
  return p;
}

/** §6.3 gate input: service lines of the latest medical record (two dependent reads). */
async function bacaJasaGate(
  supabase: Awaited<ReturnType<typeof createClient>>, visitId: string,
): Promise<{ data: { jenis: string; kategori: string | null }[] | null; error: unknown }> {
  const { data: mrGate, error: mrError } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  // Fail closed: an unreadable record must not look like "no risky service".
  if (mrError) return { data: null, error: mrError };
  if (!mrGate) return { data: [], error: null };
  const { data, error } = await supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mrGate.id);
  return { data: error ? null : data, error };
}

const consentUnreadable = "Status persetujuan tindakan belum dapat diverifikasi. Muat ulang lalu coba lagi; pembayaran belum diproses.";
const visitUnreadable = "Data kunjungan belum dapat dibaca. Muat ulang lalu coba lagi; pembayaran belum diproses.";

/** U07: lightweight per-phase timing so production latency can be measured from logs. */
function catatWaktu(label: string, ref: string) {
  const start = Date.now();
  let last = start;
  const fase: string[] = [];
  return {
    tandai(nama: string) { const now = Date.now(); fase.push(`${nama}=${now - last}ms`); last = now; },
    selesai() { console.info(`[u07:${label}] ${ref} ${fase.join(" ")} total=${Date.now() - start}ms`); },
  };
}

/** U07: post-response work (best effort, never money). Outside a request (tests) it runs inline. */
async function setelahRespons(task: () => Promise<unknown>) {
  try { after(task); } catch { await task(); }
}

const uncertainPayment = "Hasil pembayaran belum dapat dipastikan. Periksa invoice yang sudah tersimpan sebelum mencoba lagi dengan permintaan yang sama; jangan menerima pembayaran ulang.";
const todayIso = () => hariIniWIB();

function barisUntukPosting(rows: Line[], inheritInvoice = false): ClinicInvoiceLineInput[] {
  return rows.map((row) => ({
    description: row.deskripsi,
    qty: row.qty,
    price: row.harga,
    kind: row.jenis === "jasa" ? "jasa" : "obat",
    item_id: row.item_id ?? null,
    unit: row.satuan ?? null,
    prescription_item_id: row.prescription_item_id ?? null,
    ...(inheritInvoice && row.source_invoice_item_id ? {source_invoice_item_id:row.source_invoice_item_id} : {}),
    recipe_id: row.recipe_id ?? null,
    discount_percent: row.diskon_persen ?? 0,
    ...(row.service_performers != null ? {service_performers:row.service_performers} : {}),
    ...(row.salesperson_id ? {salesperson_id:row.salesperson_id} : {}),
    ...(!inheritInvoice && row.package_item_id && Number(row.package_qty) > 0 ? {package_item_id:row.package_item_id,package_qty:Number(row.package_qty)} : {}),
  }));
}

/**
 * Andri 29 Okt (opsi B): baris yang ditambah kasir sendiri — yang tidak berasal dari
 * resep dokter — harus ikut tercatat di rekam medis. Pembungkus `*_with_record`
 * membuat baris resepnya lalu memanggil RPC posting/koreksi yang sama dalam SATU
 * transaksi; badan RPC posting tidak berubah sama sekali.
 *
 * Sebelum migrasinya terpasang, pembungkusnya belum ada di database. Pembayaran tidak
 * boleh ikut mati karenanya: jalur lama dipakai apa adanya (persis perilaku hari ini).
 */
/** Hanya versi keranjang dari database ("v1:" + md5) yang diteruskan; sidik lain diabaikan. */
function cartVersionDari(formData: FormData): string | undefined {
  const versi = String(formData.get("source_version") ?? "").trim();
  return /^v1:[0-9a-f]{32}$/.test(versi) ? versi : undefined;
}

/** Versi keranjang dibaca server (pembayaran rombongan); null = database belum dimigrasi. */
async function versiKeranjangServer(supabase: Awaited<ReturnType<typeof createClient>>, visitId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("clinic_outpatient_cart_version", { p_visit_id: visitId });
  if (error?.code === "PGRST202" && error.message?.includes("clinic_outpatient_cart_version")) return null;
  if (error || typeof data !== "string" || !/^v1:[0-9a-f]{32}$/.test(data)) throw new Error("versi keranjang tidak terbaca");
  return data;
}

async function postInvoiceAtomik(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: ClinicPostInvoiceParams,
  payments?: ClinicSplitPayment[],
  demo?: { policyId: string; employees: string[] },
  admission?: { plan: string; stayType: string },
  cartVersion?: string,
): Promise<{ inpatientId?: string; invoiceId: string | null; invoiceNo: string | null; error: { code?: string; message: string } | null }> {
  const wrapper = admission ? "clinic_post_dp_and_admit_with_record" as const : "clinic_post_invoice_with_record" as const;
  // Versi keranjang yang dibuka kasir; pembungkus menolak CART_STALE bila rekam medis
  // berubah sesudahnya (mis. dokter menambah item) atau versinya tidak ada.
  const cart = cartVersion ? { p_cart_version: cartVersion } : {};
  const wrappedParams = admission
    ? { ...params, p_treatment_plan: admission.plan, p_stay_type: admission.stayType, ...cart }
    : {
      ...params,
      ...(payments ? { p_payments: payments } : {}),
      ...(demo ? { p_policy_id: demo.policyId, p_payments: payments, p_employee_ids: demo.employees } : {}),
      ...cart,
    };
  const terbungkus = await supabase.rpc(wrapper, wrappedParams);
  const { data: result, error } = isMissingRecordWrapper(terbungkus.error, wrapper, wrappedParams)
    ? admission
      ? await supabase.rpc("clinic_post_dp_and_admit", { ...params, p_treatment_plan: admission.plan, p_stay_type: admission.stayType })
      : demo
      ? await supabase.rpc("clinic_post_demo_invoice", {...params, p_policy_id:demo.policyId, p_payments:payments, p_employee_ids:demo.employees})
      : payments
      ? await supabase.rpc("clinic_post_split_invoice", { ...params, p_payments: payments })
      : await supabase.rpc("clinic_post_invoice", params)
    : terbungkus;
  const invoiceId = admission ? result?.invoice_id : result;
  const inpatientId = admission ? result?.inpatient_id : undefined;
  if (error || !invoiceId || (admission && !inpatientId)) return { invoiceId: null, invoiceNo: null, error: error ?? { message: "Hasil invoice/rawat inap belum terkonfirmasi" } };
  const { data: invoice, error: readError } = await supabase
    .from("invoices").select("invoice_no").eq("id", invoiceId).maybeSingle();
  if (readError || !invoice?.invoice_no) {
    return { invoiceId, invoiceNo: null, error: readError ?? { message: "Nomor invoice tidak terbaca setelah tersimpan" } };
  }
  return { invoiceId, inpatientId, invoiceNo: invoice.invoice_no, error: null };
}

export async function bayarVisit(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;
  const waktu = catatWaktu("bayarVisit", visitId);
  const targetInvoiceId = String(formData.get("target_invoice_id") ?? "").trim();

  // U07 batch 1: every read that needs only the visit id starts together. Each is
  // still awaited (and validated) at its original place below.
  const shiftP = mulai(supabase.auth.getUser().then(({ data: { user } }) =>
    user ? getOpenShift(supabase as never, user.id, "klinik") : null));
  const jasaP = mulai(bacaJasaGate(supabase, visitId));
  const inpatP = mulai(supabase.from("inpatient_records").select("id,consent_id").eq("visit_id", visitId).limit(1).maybeSingle());
  const inpatConsentP = mulai(inpatP.then(({ data }) => data?.consent_id
    ? supabase.rpc("clinic_inpatient_consent_valid", {p_visit_id:visitId}) : null));
  const consentsP = mulai(supabase.from("consents").select("status").eq("visit_id", visitId));
  const aturanConsentP = mulai(bacaAturanConsent(supabase));
  // Rawat inap bertahap: beberapa invoice aktif per kunjungan sejak 29 Oktober 2026.
  // `maybeSingle()` di sini dulu berubah jadi galat "tagihan belum dapat diverifikasi"
  // begitu tahap kedua terbit, sehingga rawat jalan pun ikut macet. Yang dipakai jalur
  // koreksi adalah tagihan TERBARU; tahapnya dikelola di layar tagihan rawat inap.
  const activeInvoiceQuery = supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, paid_status, metode_bayar, request_key, voucher_code, correction_pending, service_pricing_version, salesperson_id")
    .eq("visit_id", visitId).is("voided_at", null);
  const activeInvoiceP = mulai((targetInvoiceId ? activeInvoiceQuery.eq("id",targetInvoiceId) : activeInvoiceQuery)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).maybeSingle());
  const periodeP = mulai(cekPeriode(supabase, todayIso()));
  const visitP = mulai(supabase.from("visits").select("branch_id, customer_id, doctor_id, service_provider_id, pets(name), customers(name, phone)").eq("id", visitId).maybeSingle());
  const pajakP = mulai(getPajakSettings(supabase));
  const demoPolicyId = String(formData.get("demo_policy_id") ?? "").trim();
  const demoPolicyP = demoPolicyId ? mulai(supabase.from("clinic_demo_policies")
    .select("id,name,incentive_percent,fee_bearer,fee_rates,admin_revenue_code,admin_expense_code").eq("id",demoPolicyId).maybeSingle()) : null;

  // Addendum §1: transaksi wajib terikat shift klinik yang open (validasi server, bukan UI).
  const klinikShift = await shiftP;
  if (!klinikShift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);

  // §6.3: tindakan berisiko tidak boleh ditagih sebelum pemilik menandatangani form
  // persetujuan. Dicek server-side — UI menyembunyikan tombol, tapi itu bukan pengaman.
  {
    const [{ data: jasaRows, error: jasaError }, { data: inpatRow, error: inpatError }, { data: consentRows, error: consentError }] = await Promise.all([jasaP, inpatP, consentsP]);
    // Fail closed (§6.3): a gate read that errored must not count as "nothing to sign".
    if (jasaError || inpatError || consentError) redirect(`${back}?error=${encodeURIComponent(consentUnreadable)}`);
    if (inpatRow?.consent_id) {
      const linked = (await inpatConsentP)!;
      if (linked.error || linked.data !== true) redirect(`${back}?error=${encodeURIComponent("Persetujuan khusus rawat inap tidak valid.")}`);
    }
    const aturanConsent = await aturanConsentP;
    const boleh = bolehBayar(
      (jasaRows ?? []) as { jenis: string; kategori: string | null }[],
      !!inpatRow,
      (consentRows ?? []) as { status: string }[],
      aturanConsent,
    );
    if (!boleh) {
      const kat = kategoriBerisiko((jasaRows ?? []) as { jenis: string; kategori: string | null }[], !!inpatRow, aturanConsent);
      redirect(`${back}?error=${encodeURIComponent(`Form persetujuan untuk tindakan ${kat.join(", ")} belum ditandatangani`)}`);
    }
  }

  // Invoice aktif (belum di-void) untuk visit ini — kalau ada, ini jalur EDIT (Addendum §7).
  const { data: activeInvoice, error: activeInvoiceError } = await activeInvoiceP;

  if (activeInvoiceError) redirect(`${back}?error=${encodeURIComponent("Tagihan belum dapat diverifikasi. Muat ulang tanpa membuat pembayaran baru.")}`);
  if (targetInvoiceId && !activeInvoice) redirect(`${back}?error=${encodeURIComponent("Invoice yang dipilih sudah berubah atau tidak sesuai kunjungan. Muat ulang; tidak ada transaksi yang disimpan.")}`);

  // A lost create response must replay its sealed request/hash instead of
  // becoming a correction. Different creation keys keep the normal edit path.
  const submittedRequestKey = String(formData.get("requestKey") ?? "").trim();
  const isCreationReplay = !!activeInvoice && activeInvoice.request_key === submittedRequestKey;
  const existing = isCreationReplay ? null : activeInvoice;
  const intendsAdmission = formData.get("admit_after_dp") === "1";
  const stayType = formData.has("stay_type") ? parseStayType(formData.get("stay_type")) : null;
  const plan = String(formData.get("treatment_plan") ?? "").trim();
  if (intendsAdmission && (existing || !stayType || !plan || plan.length > 4000
      || formData.get("finalize") === "1" || formData.get("paid_status") !== "DP"
      || formData.has("split_payments") || demoPolicyId)) {
    redirect(`${back}?error=${encodeURIComponent("Untuk DP & Rawat Inap, isi rencana dan tipe rawat inap, bayar sebagian lalu pilih Simpan. Tagihan lama tidak diubah.")}`);
  }
  const admission = intendsAdmission && stayType ? { plan, stayType } : undefined;
  const groupedServicePricing = !isCreationReplay || activeInvoice?.service_pricing_version === 1;

  let items: Line[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    items = [];
  }
  const rows = items
    .filter((l) => l.deskripsi?.trim())
    .map((l) => ({
      deskripsi: l.deskripsi.trim(), qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
      harga: Number(l.harga) || 0, jenis: l.jenis === "jasa" ? "jasa" : "obat",
      // Diskon per baris (meeting 14 Agustus) dibatasi 0–100 di server juga:
      // layar boleh dipercaya untuk tampilan, tidak untuk uang.
      diskon_persen: Math.min(100, Math.max(0, Number(l.diskon_persen) || 0)),
      // item_id jasa IKUT DISIMPAN sejak promo klinik (2026-08-12): promo boleh
      // mengenai tindakan, dan tanpa item_id promo tidak punya pegangan tindakan
      // apa yang didiskon. Yang menjaga stok bukan lagi item_id kosong, tapi
      // filter `jenis` pada posting atomik — jasa memang tidak punya lapisan stok.
      item_id: l.item_id ?? null,
      satuan: l.satuan ?? null,
      prescription_item_id: l.prescription_item_id ?? null,
      ...(existing && l.source_invoice_item_id ? {source_invoice_item_id:l.source_invoice_item_id} : {}),
      recipe_id: l.recipe_id ?? null,
      // H05: the database verifies the package really contains this SKU.
      ...(!existing && typeof l.package_item_id === "string" && l.item_id && Number(l.package_qty) > 0
        ? {package_item_id:l.package_item_id,package_qty:Number(l.package_qty)} : {}),
      ...(l.service_performers != null ? {service_performers:clinicServicePerformerInput(l.service_performers)} : {}),
    }));

  if (rows.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Minimal 1 item tagihan")}`);
  }

  // Invoice + potong stok obat + jurnal harus jalan bareng. Periode terkunci =
  // obat keluar gudang tapi pendapatannya tidak pernah masuk buku besar.
  const pesanPeriode = await periodeP;
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  const { data: v, error: visitError } = await visitP;
  // Fail closed: posting with an unread visit would lose branch/customer (promo, points, cash account).
  if (visitError || !v) redirect(`${back}?error=${encodeURIComponent(visitUnreadable)}`);
  waktu.tandai("baca1");

  const rawSplit = formData.get("split_payments");
  let split: ReturnType<typeof parseSplitPaymentDraft> | undefined;
  if (rawSplit !== null) {
    if (existing) redirect(`${back}?error=${encodeURIComponent("Koreksi tidak boleh mengubah pembayaran campuran.")}`);
    try { split = parseSplitPaymentDraft(String(rawSplit)); }
    catch (error) { redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "Pembayaran campuran tidak valid.")}`); }
  }

  const subtotal = rows.reduce((a, l) => a + nilaiBaris(l), 0);
  const diskonManual = Number(formData.get("discount")) || 0;
  const kodeDiketik = existing ? existing.voucher_code : normalizeKode(formData.get("voucherCode")) || null;
  const branchId = v?.branch_id ?? null;

  // U07 batch 2: reads that need the visit start together; each is still awaited
  // where the sequential code awaited it.
  // Promo, voucher, dan diskon golongan DIHITUNG ULANG di server dari master —
  // angka dari layar tidak menentukan uang. Layar kasir yang sudah lama terbuka
  // bisa memegang promo yang sudah dicabut.
  const potonganP = existing ? null : mulai(hitungPotonganKlinik(supabase, {
    branchId, customerId: v?.customer_id ?? null,
    // Promo & voucher menghitung dari harga yang SUDAH kena diskon baris.
    rows: rows.map((l) => ({ item_id: l.item_id ?? null, qty: l.qty, harga: hargaNetto(l), jenis:l.jenis, satuan:l.satuan })),
    voucherCode: kodeDiketik, groupServices:groupedServicePricing,
  }));
  const poinP = mulai(bacaPoinPelanggan(supabase, v?.customer_id ?? null));
  const kasSplitP = split ? split.map(part => mulai(kodeAkunBayar(supabase, part.method, branchId))) : null;
  const salespersonP = existing || isCreationReplay ? null
    : mulai(resolveClinicSalesperson(supabase, branchId, v?.doctor_id ?? null, v?.service_provider_id ?? null));
  const kasDemoP = demoPolicyId && !split && !existing
    ? mulai(kodeAkunBayar(supabase, String(formData.get("metode_bayar") ?? "Tunai"), branchId)) : null;

  const potongan = potonganP ? await potonganP : { total: 0, tolakVoucher: null };
  if (potongan.tolakVoucher) redirect(`${back}?error=${encodeURIComponent(potongan.tolakVoucher)}`);
  // Kode kampanye (C05) disimpan terpisah; invoice tetap menyimpan voucher aslinya.
  const voucherCode = existing ? existing.voucher_code : ("voucherCode" in potongan ? potongan.voucherCode ?? null : null);
  const campaignCode = !existing && "campaignCode" in potongan ? potongan.campaignCode ?? null : null;

  // "Bayar & Selesai" memaksa lunas; "Simpan" pakai status turunan dari jumlah bayar.
  const finalize = String(formData.get("finalize") ?? "") === "1";
  const paidStatus = split || finalize ? "Lunas" : String(formData.get("paid_status") ?? "Belum Lunas");

  // Poin pelanggan dipakai setelah promo/voucher/diskon golongan, persis urutan
  // kasir petshop (permintaan Pak Aldi, meeting 14 Agustus).
  //
  // Hanya berlaku saat tagihan LUNAS: saldo poin baru dipotong di situ, dan
  // memberi potongan tanpa memotong saldo berarti poin yang sama bisa dipakai
  // berkali-kali lewat tombol Simpan.
  const poin = await poinP;
  const sebelumPoin = Math.min(subtotal, diskonManual + potongan.total);
  const poinDipakai = paidStatus === "Lunas"
    ? poinTerpakai(Number(formData.get("poinDigunakan")) || 0, poin.saldo, subtotal - sebelumPoin)
    : 0;
  const potonganPoin = poinDipakai * RUPIAH_PER_POIN;

  const discount = Math.min(subtotal, sebelumPoin + potonganPoin);
  const dpp = Math.max(0, subtotal - discount);
  // PPN hanya ditambahkan bila Mode PKP aktif (pengaturan/pajak); OFF → tax 0.
  const { tax, total } = tambahPpn(dpp, await pajakP);
  let payments: ClinicSplitPayment[] | undefined;
  if (split && kasSplitP) {
    try {
      validateSplitPaymentTotal(split, total);
      payments = await Promise.all(split.map(async (part, i) => ({ ...part,
        kas_code: await kasSplitP[i],
      })));
    } catch (error) { redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "Pembayaran campuran tidak valid.")}`); }
  }
  const metode = split?.[0].method ?? String(formData.get("metode_bayar") ?? "Tunai");
  const dpAmount = existing ? Number(existing.dp_amount)
    : paidStatus === "DP" ? Number(formData.get("dp_amount")) || 0 : 0;
  const dpDate = paidStatus === "DP" ? String(formData.get("dp_date") ?? "") || null : null;
  const reason = String(formData.get("edit_reason") ?? "").trim() || null;
  const dpOverrideReason = String(formData.get("dp_override_reason") ?? "").trim().slice(0, 500) || null;
  // Visit ditutup hanya saat lunas; DP/Belum Lunas tetap tahap Pembayaran (bisa dilanjut).
  const visitStatus = paidStatus === "Lunas" ? "Selesai" : "Pembayaran";

  if (existing) {
    if (existing.paid_status === "Lunas" && !existing.correction_pending) {
      redirect(`${back}?error=${encodeURIComponent("Tagihan lunas harus dibatalkan dan diterbitkan ulang")}`);
    }
    if ((!existing.correction_pending && paidStatus !== existing.paid_status)
        || metode !== existing.metode_bayar) {
      redirect(`${back}?error=${encodeURIComponent("Koreksi tidak boleh mengubah pembayaran. Gunakan layar piutang untuk pelunasan.")}`);
    }
    const requestKey = String(formData.get("requestKey") ?? "").trim();
    if (!requestKey || !reason) {
      redirect(`${back}?error=${encodeURIComponent("Isi alasan koreksi dan muat ulang halaman bila perlu")}`);
    }
    const koreksi = {
      p_invoice_id: existing.id,
      p_request_key: requestKey,
      p_invoice: { subtotal, discount, tax, total, dp_amount: dpAmount,
        paid_status: paidStatus, metode_bayar: metode, voucher_code: voucherCode, reason },
      p_lines: barisUntukPosting(rows, true),
    };
    // Baris BARU yang ditambahkan kasir saat koreksi ikut tercatat di rekam medis;
    // baris warisan tagihan lama dibiarkan apa adanya oleh pembungkusnya.
    const terbungkus = await supabase.rpc("clinic_edit_invoice_with_record", koreksi);
    const { error } = isMissingRecordWrapper(terbungkus.error, "clinic_edit_invoice_with_record", koreksi)
      ? await supabase.rpc("clinic_edit_invoice", koreksi)
      : terbungkus;
    if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
    waktu.tandai("koreksi");
    // U07: tier pelanggan = statistik turunan (best effort), dihitung setelah respons.
    const customerId = v?.customer_id;
    if (customerId) await setelahRespons(() => recomputeCustomerTier(supabase, customerId));
    revalidatePath(back);
    waktu.selesai();
    return { saved: true, href: `${back}?success=edit` };
  }

  // ---- jalur CREATE (invoice pertama utk visit ini) ----
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!requestKey) redirect(`${back}?error=${encodeURIComponent("Kunci transaksi tidak valid. Muat ulang halaman lalu coba lagi.")}`);
  // A replay must retain its sealed attribution even if that employee has since left.
  const storedSalesperson = activeInvoice?.salesperson_id ?? null;
  if (isCreationReplay && formData.has("salesperson_id") && (String(formData.get("salesperson_id") ?? "").trim() || null) !== storedSalesperson) {
    redirect(`${back}?error=${encodeURIComponent("Permintaan transaksi berbeda dari invoice tersimpan. Muat ulang dan periksa invoice yang sama.")}`);
  }
  const salespersonId = isCreationReplay || !salespersonP ? storedSalesperson : await salespersonP;
  let demoCustomerFee = 0;
  let demo: {policyId: string;employees: string[]} | undefined;
  if (demoPolicyId && demoPolicyP) {
    if (paidStatus !== "Lunas") redirect(`${back}?error=${encodeURIComponent("Aturan DEMO hanya untuk checkout awal lunas.")}`);
    const {data: policyRow, error: policyError} = await demoPolicyP;
    if (policyError || !policyRow) redirect(`${back}?error=${encodeURIComponent("Aturan DEMO tidak ditemukan. Muat ulang halaman.")}`);
    try {
      const employees: unknown = JSON.parse(String(formData.get("demo_employee_ids") ?? "[]"));
      if (!Array.isArray(employees) || !employees.length || employees.length>12 || employees.some(id=>typeof id!=="string" || !id)) throw new Error("Pilih petugas penerima insentif.");
      const policy: DemoFinancialPolicy = {id:policyRow.id,name:policyRow.name,incentivePercent:Number(policyRow.incentive_percent),feeBearer:policyRow.fee_bearer,
        feeRates:policyRow.fee_rates,adminRevenueCode:policyRow.admin_revenue_code,adminExpenseCode:policyRow.admin_expense_code};
      payments = payments ?? [{method:metode,amount:total,kas_code:kasDemoP ? await kasDemoP : await kodeAkunBayar(supabase,metode,branchId)}];
      const quote = quoteDemoPayments(policy,payments);
      demoCustomerFee = quote.customerFee;
      if (!split && (!Number.isFinite(Number(formData.get("demo_received"))) || Number(formData.get("demo_received")) < total+quote.customerFee)) throw new Error("Uang diterima belum menutup tagihan termasuk admin.");
      demo = {policyId:demoPolicyId,employees};
    } catch (error) { redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "Aturan DEMO tidak valid.")}`); }
  }
  waktu.tandai("baca2");
  const posted = await postInvoiceAtomik(supabase, {
    p_visit_id: visitId,
    p_request_key: requestKey,
    p_invoice: {
      tanggal: todayIso(), subtotal, discount, tax, total, dp_amount: dpAmount, dp_date: dpDate,
      paid_status: paidStatus as "Belum Lunas" | "DP" | "Lunas", metode_bayar: metode,
      shift_id: klinikShift.id, voucher_code: voucherCode, salesperson_id: salespersonId,
      // Uang muka minimal ditegakkan di RPC posting; alasan penerobosan ikut dikirim dan
      // dicatat di sana beserta siapa dan kapannya (Andri, 29 Oktober 2026).
      ...(dpOverrideReason ? { dp_override_reason: dpOverrideReason } : {}),
      ...(campaignCode ? { campaign_code: campaignCode } : {}),
      ...(groupedServicePricing ? {service_pricing_version:1 as const} : {}),
    },
    p_lines: barisUntukPosting(rows),
  }, payments, demo, admission, cartVersionDari(formData));
  if (posted.error || !posted.invoiceNo) {
    redirect(`${back}?error=${encodeURIComponent(posted.invoiceId ? "Invoice sudah tersimpan, tetapi rinciannya belum dapat dibaca. Jangan menerima pembayaran ulang; muat ulang dan periksa invoice yang sama." : parseClinicPostingError(posted.error, uncertainPayment))}`);
  }
  const invoiceNo = posted.invoiceNo;
  waktu.tandai("posting");

  // Paid creation and checkout commit atomically in the posting RPC. Do not
  // repeat checkout here: a retry may arrive after later inpatient admission.
  if (visitStatus !== "Selesai" && !admission) {
    const visitUpdated = await supabase.from("visits").update({ status: visitStatus }).eq("id", visitId);
    if (visitUpdated.error) redirect(`${back}?error=${encodeURIComponent("Invoice sudah tersimpan, tetapi status kunjungan belum terkonfirmasi. Jangan membuat invoice baru; muat ulang dan periksa tagihan yang sama.")}`);
  }

  // Poin: dipakai & didapat dicatat saat tagihan benar-benar LUNAS. Kalau dicatat
  // saat DP, pelanggan sudah dapat poin atas uang yang belum masuk.
  if (paidStatus === "Lunas" && !isCreationReplay) {
    await catatPoinKlinik(supabase, {
      customerId: v?.customer_id ?? null, ref: invoiceNo,
      dipakai: poinDipakai, totalDibayar: total,
      rupiahPerPoin: poin.rupiahPerPoin, saldoAwal: poin.saldo,
    });
  }

  const customer = v?.customers as { name?: string; phone?: string } | { name?: string; phone?: string }[] | null;
  const pet = v?.pets as { name?: string } | { name?: string }[] | null;
  const cust = Array.isArray(customer) ? customer[0] : customer;
  const patient = Array.isArray(pet) ? pet[0] : pet;
  if (paidStatus === "Lunas" && v?.customer_id && cust?.phone) {
    const struk = {
      invoiceNo, customerId: v.customer_id, phone: cust.phone, customerName: cust.name ?? "Kak", petName: patient?.name,
      total: total + demoCustomerFee, items: [...rows.map((r) => ({ deskripsi: r.deskripsi, qty: r.qty, harga: r.harga })),
        ...(demoCustomerFee > 0 ? [{deskripsi:"Admin pembayaran DEMO",qty:1,harga:demoCustomerFee}] : [])],
    };
    // U07: struk WA (3 bacaan/tulisan log + panggilan ke penyedia WA) tidak lagi
    // menahan kasir. Hasilnya memang tidak dipakai layar; idempotensi tetap dijaga
    // oleh log `receipt:<no invoice>`. Di luar konteks request (tes) jalan langsung.
    const kirim = () => kirimStrukWa(supabase, struk).then(
      () => undefined,
      // Hasil ok:false (mis. WA belum diaktifkan) sudah tercatat di log WA; yang
      // dicatat di sini hanya kegagalan tak terduga agar tidak hilang diam-diam.
      (error: unknown) => { console.error(`[struk-wa] ${invoiceNo}: pengiriman gagal`, error); },
    );
    await setelahRespons(kirim);
  }

  // U07: tier pelanggan = statistik turunan (best effort, tidak pernah menggagalkan
  // pembayaran), jadi ikut dihitung setelah respons bersama struk WA. Poin tetap
  // dicatat di atas sebelum respons karena itu nilai uang.
  const customerId = v?.customer_id;
  if (customerId) await setelahRespons(() => recomputeCustomerTier(supabase, customerId));
  waktu.tandai("pasca");
  // tetap di halaman pembayaran (read-only) supaya tombol Struk/Invoice langsung terlihat.
  revalidatePath(back);
  waktu.selesai();
  if (posted.inpatientId) {
    for (const path of ["/klinik/rawat-inap", "/klinik/antrian", "/klinik/rekam-medis", `/klinik/rekam-medis/${visitId}`]) revalidatePath(path);
    return { saved: true, href: `/klinik/rawat-inap/${posted.inpatientId}?success=admit` };
  }
  return { saved: true, href: `/klinik/pembayaran/${visitId}?success=bayar` };
}


/**
 * Bayar sekaligus seluruh kunjungan satu pemilik pada hari itu (satu kedatangan,
 * beberapa hewan). Pemilik cukup membayar sekali; catatannya tetap terpisah per
 * hewan supaya rekam medis, insentif dokter, dan pembukuan tidak tercampur.
 *
 * Yang diproses hanya kunjungan yang tagihannya BELUM dibuat. Kunjungan yang sudah
 * punya invoice (DP, sebagian dibayar, atau perlu diedit) sengaja dilewati dan
 * dilaporkan — jalur pelunasannya punya jurnal sendiri dan tidak boleh ditebak
 * dari layar ini.
 */
export async function bayarRombongan(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!requestKey) redirect(`${back}?error=${encodeURIComponent("Kunci transaksi tidak valid. Muat ulang halaman lalu coba lagi.")}`);
  const metode = String(formData.get("metode_bayar") ?? "Tunai");
  const kodeDiketik = normalizeKode(formData.get("voucherCode")) || null;
  const poinDiminta = Number(formData.get("poinDigunakan")) || 0;
  const waktu = catatWaktu("bayarRombongan", visitId);

  // U07 batch 1: reads that need only the visit id start together; each is still
  // awaited (and validated) at its original place below.
  const kampanyeP = kodeDiketik ? mulai(bacaKodeKampanye(supabase, kodeDiketik)) : null;
  const shiftP = mulai(supabase.auth.getUser().then(({ data: { user } }) =>
    user ? getOpenShift(supabase as never, user.id, "klinik") : null));
  const rombonganP = mulai(bacaRombongan(supabase, visitId));
  const pajakP = mulai(getPajakSettings(supabase));
  // Aturan consent = master global; dibaca sekali untuk semua hewan.
  const aturanConsentP = mulai(bacaAturanConsent(supabase));
  const poinP = mulai(rombonganP.then((r) => bacaPoinPelanggan(supabase, r?.customerId ?? null)));

  // Kode kampanye (C05): satu kedatangan = satu kali pakai kode. Kodenya diterjemahkan ke
  // voucher/promo tujuannya, potongannya dibagi ke nota tiap hewan seperti voucher biasa,
  // dan kodenya ditempel ke SATU nota saja (nota pertama yang kena potongannya) supaya
  // database menghitung satu pemakaian dan menegakkan batasnya di situ.
  const kampanye = kampanyeP ? await kampanyeP : null;
  if (kampanye && !kampanye.is_active) {
    redirect(`${back}?error=${encodeURIComponent(pesanKampanyeDitolak(kampanye, true, true) ?? "Kode kampanye tidak berlaku")}`);
  }
  if (kampanye && !kampanye.promo_id && !kampanye.voucher_code) {
    redirect(`${back}?error=${encodeURIComponent(`Voucher untuk kode ${kampanye.code} tidak ditemukan`)}`);
  }
  const voucherCode = kampanye ? kampanye.voucher_code : kodeDiketik;
  const promoKampanyeId = kampanye?.promo_id ?? null;

  const klinikShift = await shiftP;
  if (!klinikShift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);

  const rombongan = await rombonganP;
  const belum = (rombongan?.baris ?? []).filter((b) => b.invoiceNo === null);
  if (!rombongan || rombongan.baris.length < 2) {
    redirect(`${back}?error=${encodeURIComponent("Pemilik ini hanya punya satu kunjungan hari ini")}`);
  }
  if (belum.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Semua tagihan sudah dibuat — selesaikan lewat masing-masing kunjungan")}`);
  }

  const pajakSettings = await pajakP;
  const dilewati: string[] = [];
  let jumlahLunas = 0;

  // TAHAP 1 — kumpulkan dulu tagihan tiap hewan beserta promo & diskon golongannya.
  // Voucher baru bisa dibagi setelah semua porsi diketahui: kodenya berlaku sekali
  // untuk satu kedatangan, tapi potongannya menempel proporsional di tiap nota
  // (kesepakatan 2026-08-12) — kalau ditumpuk ke satu hewan, insentif dokter yang
  // menangani hewan itu ambles padahal bukan porsinya.
  type Siap = {
    b: typeof belum[number];
    salespersonId: string | null;
    rows: Awaited<ReturnType<typeof barisTagihanVisit>>;
    cartVersion: string | null;
    subtotal: number;
    potonganNonVoucher: number;
    /** Promo kode kampanye memotong tagihan hewan ini / berlaku di cabangnya. */
    kenaPromoKampanye: boolean;
    promoKampanyeTersedia: boolean;
  };
  const siap: Siap[] = [];

  // U07: tagihan tiap hewan disiapkan bersamaan (hanya bacaan), lalu hasilnya dipakai
  // berurutan seperti dulu — urutan "dilewati", nota, dan galat tetap sama.
  const siapkan = (b: typeof belum[number]) => {
    const visitP = mulai(supabase
      .from("visits").select("branch_id, customer_id, doctor_id, service_provider_id, poli").eq("id", b.visitId).maybeSingle());
    // §6.3: tindakan berisiko wajib punya persetujuan bertanda tangan. Berlaku per
    // hewan — satu hewan yang belum menandatangani tidak boleh ikut terbayar diam-diam.
    const jasaP = mulai(bacaJasaGate(supabase, b.visitId));
    const inpatP = mulai(supabase.from("inpatient_records").select("id").eq("visit_id", b.visitId).limit(1).maybeSingle());
    const consentsP = mulai(supabase.from("consents").select("status").eq("visit_id", b.visitId));
    return mulai((async (): Promise<Siap | null> => {
      const { data: v, error: visitError } = await visitP;
      // Fail closed: an unreadable visit/gate stops the whole group before any invoice posts.
      if (visitError) redirect(`${back}?error=${encodeURIComponent(`${b.hewan}: ${visitUnreadable}`)}`);
      if (!v) return null;
      const [{ data: jasaRows, error: jasaError }, { data: inpatRow, error: inpatError }, { data: consentRows, error: consentError }] = await Promise.all([jasaP, inpatP, consentsP]);
      if (jasaError || inpatError || consentError) redirect(`${back}?error=${encodeURIComponent(`${b.hewan}: ${consentUnreadable}`)}`);
      if (!bolehBayar(
        (jasaRows ?? []) as { jenis: string; kategori: string | null }[],
        !!inpatRow,
        (consentRows ?? []) as { status: string }[],
        await aturanConsentP,
      )) return null;

      const salespersonP = mulai(resolveClinicSalesperson(supabase, v.branch_id ?? null, v.doctor_id ?? null, v.service_provider_id ?? null));
      // Versi dibaca SEBELUM baris: item dokter yang masuk di antaranya ditolak CART_STALE,
      // bukan terlewat dari nota hewan ini.
      const cartVersion = await versiKeranjangServer(supabase, b.visitId)
        .catch(() => redirect(`${back}?error=${encodeURIComponent(`${b.hewan}: Tagihan belum dapat diverifikasi. Muat ulang tanpa membayar ulang.`)}`));
      const rows = await barisTagihanVisit(supabase, b.visitId, String(v.poli ?? "Poli Umum"));
      const subtotal = rows.reduce((a, l) => a + nilaiBaris(l), 0);
      const potonganPet = await hitungPotonganKlinik(supabase, {
        branchId: v.branch_id ?? null, customerId: v.customer_id ?? null,
        rows:rows.map(line=>({item_id:line.item_id,qty:line.qty,harga:hargaNetto(line),jenis:line.jenis,satuan:line.satuan})),
        ...(promoKampanyeId ? { promoKampanyeId } : {}),
      });
      const salespersonId = await salespersonP;
      return { b, salespersonId, rows, cartVersion, subtotal, potonganNonVoucher: potonganPet.total,
        kenaPromoKampanye: !!potonganPet.promoKampanyeTerpakai, promoKampanyeTersedia: !!potonganPet.promoKampanyeTersedia };
    })());
  };
  const persiapan = belum.map(siapkan);
  for (const [i, b] of belum.entries()) {
    const hasil = await persiapan[i];
    if (!hasil) { dilewati.push(b.hewan); continue; }
    siap.push(hasil);
  }
  waktu.tandai("baca");

  // Kode terikat promo: cukup satu hewan yang kena promonya (diperiksa untuk seluruh rombongan).
  if (kampanye?.promo_id) {
    const tolak = pesanKampanyeDitolak(kampanye, siap.some((s) => s.promoKampanyeTersedia), siap.some((s) => s.kenaPromoKampanye));
    if (tolak) redirect(`${back}?error=${encodeURIComponent(tolak)}`);
  }

  // Voucher dihitung dari GABUNGAN tagihan seluruh hewan (setelah promo & golongan),
  // lalu dibagi proporsional. Satu kedatangan = satu kali pakai kode.
  const dasarPerPet = siap.map((s) => Math.max(0, s.subtotal - s.potonganNonVoucher));
  let voucherTotal = 0;
  if (voucherCode && dasarPerPet.some((d) => d > 0)) {
    // Voucher bersasaran ikut diperiksa terhadap pemilik rombongan ini.
    const [{ data: vRow }, { data: custRomb }] = await Promise.all([
      supabase
        .from("vouchers")
        .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id")
        .eq("code", voucherCode).maybeSingle(),
      rombongan.customerId
        ? supabase.from("customers").select("category_id").eq("id", rombongan.customerId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const tolak = pesanVoucherDitolak((vRow ?? null) as VoucherRow | null, hariIniWIB(), {
      dasar: dasarPerPet.reduce((a, d) => a + d, 0),
      adaPromoOtomatis: siap.some((s) => s.potonganNonVoucher > 0),
      customerId: rombongan.customerId ?? null,
      categoryId: (custRomb?.category_id as string | null) ?? null,
    });
    if (tolak) redirect(`${back}?error=${encodeURIComponent(tolak)}`);
    voucherTotal = potonganVoucher(dasarPerPet.reduce((a, d) => a + d, 0), vRow as VoucherRow);
  }
  const voucherPerPet = bagiPotongan(dasarPerPet, voucherTotal);
  // Nota yang menikmati kode kampanye: kena potongan vouchernya, atau kena promonya.
  const pakaiKode = siap.map((s, i) => !!kampanye && (kampanye.promo_id ? s.kenaPromoKampanye : voucherPerPet[i] > 0));

  // Poin dipakai untuk SATU kedatangan, lalu dibagi proporsional ke nota tiap hewan
  // — perlakuannya persis voucher (permintaan Pak Aldi: poin di klinik harus sama
  // seperti di petshop).
  const poin = await poinP;
  const dasarSetelahVoucher = dasarPerPet.map((d, i) => Math.max(0, d - voucherPerPet[i]));
  const poinDipakai = poinTerpakai(
    poinDiminta, poin.saldo, dasarSetelahVoucher.reduce((a, d) => a + d, 0),
  );
  const poinPerPet = bagiPotongan(dasarSetelahVoucher, poinDipakai * RUPIAH_PER_POIN);

  // TAHAP 2 — terbitkan notanya satu per satu. Dengan kode kampanye, nota yang kena
  // potongannya diterbitkan lebih dulu: nota pertama membawa kodenya, sehingga batas
  // pemakaian sudah diperiksa database sebelum nota lain ikut menikmati potongan.
  const notaPoin: NotaPoin[] = [];
  const urutan = siap.map((_, i) => i);
  if (kampanye) urutan.sort((a, b) => Number(pakaiKode[b]) - Number(pakaiKode[a]));
  let kodeMenunggu = kampanye?.code ?? null;     // belum menempel di nota mana pun
  let kampanyeDitolak: string | null = null;
  let notaTersimpan = 0;                          // termasuk nota yang nomornya belum terbaca
  for (const idx of urutan) {
    const s = siap[idx];
    const { b, rows, subtotal, salespersonId, cartVersion } = s;
    if (pakaiKode[idx] && kampanyeDitolak) { dilewati.push(`${b.hewan}: ${kampanyeDitolak}`); continue; }
    const bawaKode = pakaiKode[idx] ? kodeMenunggu : null;
    const discount = Math.min(subtotal, s.potonganNonVoucher + voucherPerPet[idx] + poinPerPet[idx]);
    const dpp = Math.max(0, subtotal - discount);
    const { tax, total } = tambahPpn(dpp, pajakSettings);

    const posted = await postInvoiceAtomik(supabase, {
      p_visit_id: b.visitId,
      p_request_key: `${requestKey}:${b.visitId}`,
      p_invoice: {
        tanggal: todayIso(), subtotal, discount, tax, total, dp_amount: 0, dp_date: null,
        paid_status: "Lunas", metode_bayar: metode, shift_id: klinikShift.id,
        voucher_code: voucherPerPet[idx] > 0 ? voucherCode : null, salesperson_id: salespersonId,
        ...(bawaKode ? { campaign_code: bawaKode } : {}),
        service_pricing_version:1,
      },
      p_lines: barisUntukPosting(rows),
    }, undefined, undefined, undefined, cartVersion ?? undefined);
    // Nota yang tersimpan sudah memakai kodenya (dihitung database), walau nomornya belum terbaca.
    if (posted.invoiceId) notaTersimpan++;
    if (bawaKode && posted.invoiceId) kodeMenunggu = null;
    if (posted.error || !posted.invoiceNo) {
      const pesanKampanye = bawaKode && !posted.invoiceId ? pesanGagalKampanye(posted.error?.message) : null;
      if (pesanKampanye) {
        // Batas/izin kode ditolak database: belum ada nota terbit → batalkan semuanya dengan pesan jelas.
        if (notaTersimpan === 0) redirect(`${back}?error=${encodeURIComponent(pesanKampanye)}`);
        kampanyeDitolak = pesanKampanye;   // nota lain yang menikmati kode ini ikut dilewati
      }
      dilewati.push(`${b.hewan}: ${posted.invoiceId ? "invoice sudah tersimpan; periksa status tanpa membayar ulang" : parseClinicPostingError(posted.error, uncertainPayment)}`);
      continue;
    }

    // Poin yang benar-benar terpakai dihitung dari nota yang BERHASIL terbit —
    // porsi hewan yang gagal tidak boleh ikut memotong saldo pelanggan. Dicatat per
    // nota (ref = nomor invoice) supaya refund invoice itu ikut menyesuaikan poinnya.
    notaPoin.push({ ref: posted.invoiceNo, dipakai: Math.floor(poinPerPet[idx] / RUPIAH_PER_POIN), total });
    jumlahLunas++;
  }

  if (jumlahLunas > 0) {
    await catatPoinNota(supabase, {
      customerId: rombongan.customerId ?? null,
      nota: notaPoin,
      rupiahPerPoin: poin.rupiahPerPoin,
      saldoAwal: poin.saldo,
    });
  }

  waktu.tandai("posting");
  // U07: tier pelanggan = statistik turunan (best effort), dihitung setelah respons.
  const customerId = rombongan.customerId;
  if (customerId) await setelahRespons(() => recomputeCustomerTier(supabase, customerId));
  waktu.selesai();

  if (jumlahLunas === 0) {
    redirect(`${back}?error=${encodeURIComponent(`Tidak ada tagihan yang bisa diselesaikan sekaligus (${dilewati.join(", ")}) — buka satu per satu`)}`);
  }
  const sisa = dilewati.length ? `&dilewati=${encodeURIComponent(dilewati.join(", "))}` : "";
  redirect(`${back}?success=rombongan&lunas=${jumlahLunas}${sisa}${dilewati.length === 0 ? transactionDraftAck(formData) : ""}`);
}

// Addendum §7: reverse the ledger and reissue within one transaction.
export async function voidAndReissue(formData: FormData) {
  const supabase = await createClient();
  const visitId = String(formData.get("visitId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!visitId) redirect("/klinik/antrian?error=Visit%20tidak%20valid");
  const back = `/klinik/pembayaran/${visitId}`;
  if (!invoiceId || !requestKey || !reason) {
    redirect(`${back}?error=${encodeURIComponent("Isi alasan pembatalan dan muat ulang halaman bila perlu")}`);
  }
  const { data: invoice } = await supabase.from("invoices")
    .select("visit_id").eq("id", invoiceId).maybeSingle();
  if (!invoice || invoice.visit_id !== visitId) {
    redirect(`${back}?error=${encodeURIComponent("Tagihan tidak cocok dengan kunjungan")}`);
  }
  const { error } = await supabase.rpc("clinic_void_reissue_invoice", {
    p_invoice_id: invoiceId, p_request_key: requestKey, p_reason: reason,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
  redirect(`${back}?success=reissue${transactionDraftAck(formData)}`);
}
