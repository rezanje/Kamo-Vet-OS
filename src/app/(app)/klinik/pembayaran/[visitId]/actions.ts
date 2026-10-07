"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { resolveClinicSalesperson } from "@/lib/clinic-payment";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPajakSettings, tambahPpn } from "@/lib/pajak";
import { getOpenShift } from "@/lib/shift";
import { bolehBayar, kategoriBerisiko } from "@/lib/tindakan";
import { bacaAturanConsent } from "@/lib/consent-server";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { bacaPoinPelanggan, catatPoinKlinik, poinTerpakai, RUPIAH_PER_POIN } from "@/lib/poin-klinik";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { bacaRombongan } from "@/lib/rombongan-server";
import { barisTagihanVisit, hitungPotonganKlinik, bagiPotongan, hargaNetto, nilaiBaris } from "@/lib/tagihan-klinik";
import { parseClinicPostingError, type ClinicInvoiceLineInput, type ClinicPostInvoiceParams } from "@/lib/klinik-posting";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher, type VoucherRow } from "@/lib/voucher";
import { kirimStrukWa } from "@/lib/wa-engine";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { parseSplitPaymentDraft, validateSplitPaymentTotal, type ClinicSplitPayment } from "@/lib/clinic-split-payment";

type Line = {
  deskripsi: string; qty: number; harga: number; jenis?: string; item_id?: string | null;
  satuan?: string | null; prescription_item_id?: string | null; recipe_id?: string | null;
  diskon_persen?: number;
};

const todayIso = () => hariIniWIB();

function barisUntukPosting(rows: Line[]): ClinicInvoiceLineInput[] {
  return rows.map((row) => ({
    description: row.deskripsi,
    qty: row.qty,
    price: row.harga,
    kind: row.jenis === "jasa" ? "jasa" : "obat",
    item_id: row.item_id ?? null,
    unit: row.satuan ?? null,
    prescription_item_id: row.prescription_item_id ?? null,
    recipe_id: row.recipe_id ?? null,
    discount_percent: row.diskon_persen ?? 0,
  }));
}

async function postInvoiceAtomik(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: ClinicPostInvoiceParams,
  payments?: ClinicSplitPayment[],
): Promise<{ invoiceNo: string | null; error: { code?: string; message: string } | null }> {
  const { data: invoiceId, error } = payments
    ? await supabase.rpc("clinic_post_split_invoice", { ...params, p_payments: payments })
    : await supabase.rpc("clinic_post_invoice", params);
  if (error || !invoiceId) return { invoiceNo: null, error: error ?? { message: "Invoice tidak terbentuk" } };
  const { data: invoice, error: readError } = await supabase
    .from("invoices").select("invoice_no").eq("id", invoiceId).maybeSingle();
  if (readError || !invoice?.invoice_no) {
    return { invoiceNo: null, error: readError ?? { message: "Nomor invoice tidak terbaca setelah tersimpan" } };
  }
  return { invoiceNo: invoice.invoice_no, error: null };
}

export async function bayarVisit(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;

  // Addendum §1: transaksi wajib terikat shift klinik yang open (validasi server, bukan UI).
  const { data: { user: payUser } } = await supabase.auth.getUser();
  const klinikShift = payUser ? await getOpenShift(supabase as never, payUser.id, "klinik") : null;
  if (!klinikShift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);

  // §6.3: tindakan berisiko tidak boleh ditagih sebelum pemilik menandatangani form
  // persetujuan. Dicek server-side — UI menyembunyikan tombol, tapi itu bukan pengaman.
  {
    const { data: mrGate } = await supabase
      .from("medical_records").select("id").eq("visit_id", visitId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const [{ data: jasaRows }, { data: inpatRow }, { data: consentRows }] = await Promise.all([
      mrGate
        ? supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mrGate.id)
        : Promise.resolve({ data: [] as { jenis: string; kategori: string | null }[] }),
      supabase.from("inpatient_records").select("id").eq("visit_id", visitId).limit(1).maybeSingle(),
      supabase.from("consents").select("status").eq("visit_id", visitId),
    ]);
    const aturanConsent = await bacaAturanConsent(supabase);
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
      recipe_id: l.recipe_id ?? null,
    }));

  if (rows.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Minimal 1 item tagihan")}`);
  }

  // Invoice + potong stok obat + jurnal harus jalan bareng. Periode terkunci =
  // obat keluar gudang tapi pendapatannya tidak pernah masuk buku besar.
  const pesanPeriode = await cekPeriode(supabase, todayIso());
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  const { data: v } = await supabase.from("visits").select("branch_id, customer_id, doctor_id, service_provider_id, pets(name), customers(name, phone)").eq("id", visitId).maybeSingle();

  // Invoice aktif (belum di-void) untuk visit ini — kalau ada, ini jalur EDIT (Addendum §7).
  const { data: activeInvoice } = await supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, paid_status, metode_bayar, request_key, voucher_code, correction_pending")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();

  // A lost create response must replay its sealed request/hash instead of
  // becoming a correction. Different creation keys keep the normal edit path.
  const submittedRequestKey = String(formData.get("requestKey") ?? "").trim();
  const isCreationReplay = !!activeInvoice && activeInvoice.request_key === submittedRequestKey;
  const existing = isCreationReplay ? null : activeInvoice;
  const rawSplit = formData.get("split_payments");
  let split: ReturnType<typeof parseSplitPaymentDraft> | undefined;
  if (rawSplit !== null) {
    if (existing) redirect(`${back}?error=${encodeURIComponent("Koreksi tidak boleh mengubah pembayaran campuran.")}`);
    try { split = parseSplitPaymentDraft(String(rawSplit)); }
    catch (error) { redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "Pembayaran campuran tidak valid.")}`); }
  }

  const subtotal = rows.reduce((a, l) => a + nilaiBaris(l), 0);
  const diskonManual = Number(formData.get("discount")) || 0;
  const voucherCode = existing ? existing.voucher_code : normalizeKode(formData.get("voucherCode")) || null;

  // Promo, voucher, dan diskon golongan DIHITUNG ULANG di server dari master —
  // angka dari layar tidak menentukan uang. Layar kasir yang sudah lama terbuka
  // bisa memegang promo yang sudah dicabut.
  const potongan = existing ? { total: 0, tolakVoucher: null } : await hitungPotonganKlinik(supabase, {
    branchId: v?.branch_id ?? null, customerId: v?.customer_id ?? null,
    // Promo & voucher menghitung dari harga yang SUDAH kena diskon baris.
    rows: rows.map((l) => ({ item_id: l.item_id ?? null, qty: l.qty, harga: hargaNetto(l) })),
    voucherCode,
  });
  if (potongan.tolakVoucher) redirect(`${back}?error=${encodeURIComponent(potongan.tolakVoucher)}`);

  // "Bayar & Selesai" memaksa lunas; "Simpan" pakai status turunan dari jumlah bayar.
  const finalize = String(formData.get("finalize") ?? "") === "1";
  const paidStatus = split || finalize ? "Lunas" : String(formData.get("paid_status") ?? "Belum Lunas");

  // Poin pelanggan dipakai setelah promo/voucher/diskon golongan, persis urutan
  // kasir petshop (permintaan Pak Aldi, meeting 14 Agustus).
  //
  // Hanya berlaku saat tagihan LUNAS: saldo poin baru dipotong di situ, dan
  // memberi potongan tanpa memotong saldo berarti poin yang sama bisa dipakai
  // berkali-kali lewat tombol Simpan.
  const poin = await bacaPoinPelanggan(supabase, v?.customer_id ?? null);
  const sebelumPoin = Math.min(subtotal, diskonManual + potongan.total);
  const poinDipakai = paidStatus === "Lunas"
    ? poinTerpakai(Number(formData.get("poinDigunakan")) || 0, poin.saldo, subtotal - sebelumPoin)
    : 0;
  const potonganPoin = poinDipakai * RUPIAH_PER_POIN;

  const discount = Math.min(subtotal, sebelumPoin + potonganPoin);
  const dpp = Math.max(0, subtotal - discount);
  // PPN hanya ditambahkan bila Mode PKP aktif (pengaturan/pajak); OFF → tax 0.
  const { tax, total } = tambahPpn(dpp, await getPajakSettings(supabase));
  let payments: ClinicSplitPayment[] | undefined;
  if (split) {
    try {
      validateSplitPaymentTotal(split, total);
      payments = await Promise.all(split.map(async part => ({ ...part,
        kas_code: await kodeAkunBayar(supabase, part.method, v?.branch_id ?? null),
      })));
    } catch (error) { redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "Pembayaran campuran tidak valid.")}`); }
  }
  const metode = split?.[0].method ?? String(formData.get("metode_bayar") ?? "Tunai");
  const dpAmount = existing ? Number(existing.dp_amount)
    : paidStatus === "DP" ? Number(formData.get("dp_amount")) || 0 : 0;
  const dpDate = paidStatus === "DP" ? String(formData.get("dp_date") ?? "") || null : null;
  const reason = String(formData.get("edit_reason") ?? "").trim() || null;
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
    const { error } = await supabase.rpc("clinic_edit_invoice", {
      p_invoice_id: existing.id,
      p_request_key: requestKey,
      p_invoice: { subtotal, discount, tax, total, dp_amount: dpAmount,
        paid_status: paidStatus, metode_bayar: metode, voucher_code: voucherCode, reason },
      p_lines: barisUntukPosting(rows),
    });
    if (error) redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(error))}`);
    if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
    revalidatePath(back);
    return { saved: true, href: `${back}?success=edit` };
  }

  // ---- jalur CREATE (invoice pertama utk visit ini) ----
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!requestKey) redirect(`${back}?error=${encodeURIComponent("Kunci transaksi tidak valid. Muat ulang halaman lalu coba lagi.")}`);
  let salespersonId: string | null = null;
  try {
    salespersonId = await resolveClinicSalesperson(supabase, v?.branch_id ?? null,
      v?.doctor_id ?? null, v?.service_provider_id ?? null,
      formData.has("salesperson_id") ? String(formData.get("salesperson_id") ?? "") : undefined);
  } catch (error) {
    redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "Penjual tidak valid.")}`);
  }
  const posted = await postInvoiceAtomik(supabase, {
    p_visit_id: visitId,
    p_request_key: requestKey,
    p_invoice: {
      tanggal: todayIso(), subtotal, discount, tax, total, dp_amount: dpAmount, dp_date: dpDate,
      paid_status: paidStatus as "Belum Lunas" | "DP" | "Lunas", metode_bayar: metode,
      shift_id: klinikShift.id, voucher_code: voucherCode, salesperson_id: salespersonId,
    },
    p_lines: barisUntukPosting(rows),
  }, payments);
  if (posted.error || !posted.invoiceNo) {
    redirect(`${back}?error=${encodeURIComponent(parseClinicPostingError(posted.error))}`);
  }
  const invoiceNo = posted.invoiceNo;

  if (visitStatus === "Selesai") {
    const checkedOut = await supabase.rpc("set_visit_service_state", { p_visit_id: visitId, p_action: "checkout" });
    if (checkedOut.error) redirect(`${back}?error=${encodeURIComponent(checkedOut.error.message)}`);
  } else {
    const visitUpdated = await supabase.from("visits").update({ status: visitStatus }).eq("id", visitId);
    if (visitUpdated.error) redirect(`${back}?error=${encodeURIComponent(visitUpdated.error.message)}`);
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
    await kirimStrukWa(supabase, {
      invoiceNo, customerId: v.customer_id, phone: cust.phone, customerName: cust.name ?? "Kak", petName: patient?.name,
      total, items: rows.map((r) => ({ deskripsi: r.deskripsi, qty: r.qty, harga: r.harga })),
    });
  }

  if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
  // tetap di halaman pembayaran (read-only) supaya tombol Struk/Invoice langsung terlihat.
  revalidatePath(back);
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
  const voucherCode = normalizeKode(formData.get("voucherCode")) || null;
  const poinDiminta = Number(formData.get("poinDigunakan")) || 0;

  const { data: { user } } = await supabase.auth.getUser();
  const klinikShift = user ? await getOpenShift(supabase as never, user.id, "klinik") : null;
  if (!klinikShift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);

  const rombongan = await bacaRombongan(supabase, visitId);
  const belum = (rombongan?.baris ?? []).filter((b) => b.invoiceNo === null);
  if (!rombongan || rombongan.baris.length < 2) {
    redirect(`${back}?error=${encodeURIComponent("Pemilik ini hanya punya satu kunjungan hari ini")}`);
  }
  if (belum.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Semua tagihan sudah dibuat — selesaikan lewat masing-masing kunjungan")}`);
  }

  const pajakSettings = await getPajakSettings(supabase);
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
    subtotal: number;
    potonganNonVoucher: number;
  };
  const siap: Siap[] = [];

  for (const b of belum) {
    const { data: v } = await supabase
      .from("visits").select("branch_id, customer_id, doctor_id, service_provider_id, poli").eq("id", b.visitId).maybeSingle();
    if (!v) { dilewati.push(b.hewan); continue; }

    // §6.3: tindakan berisiko wajib punya persetujuan bertanda tangan. Berlaku per
    // hewan — satu hewan yang belum menandatangani tidak boleh ikut terbayar diam-diam.
    const { data: mrGate } = await supabase
      .from("medical_records").select("id").eq("visit_id", b.visitId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const [{ data: jasaRows }, { data: inpatRow }, { data: consentRows }] = await Promise.all([
      mrGate
        ? supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mrGate.id)
        : Promise.resolve({ data: [] as { jenis: string; kategori: string | null }[] }),
      supabase.from("inpatient_records").select("id").eq("visit_id", b.visitId).limit(1).maybeSingle(),
      supabase.from("consents").select("status").eq("visit_id", b.visitId),
    ]);
    if (!bolehBayar(
      (jasaRows ?? []) as { jenis: string; kategori: string | null }[],
      !!inpatRow,
      (consentRows ?? []) as { status: string }[],
      await bacaAturanConsent(supabase),
    )) {
      dilewati.push(b.hewan);
      continue;
    }

    const rows = await barisTagihanVisit(supabase, b.visitId, String(v.poli ?? "Poli Umum"));
    const subtotal = rows.reduce((a, l) => a + nilaiBaris(l), 0);
    const potonganPet = await hitungPotonganKlinik(supabase, {
      branchId: v.branch_id ?? null, customerId: v.customer_id ?? null, rows,
    });
    const salespersonId = await resolveClinicSalesperson(supabase, v.branch_id ?? null, v.doctor_id ?? null, v.service_provider_id ?? null);
    siap.push({ b, salespersonId, rows, subtotal, potonganNonVoucher: potonganPet.total });
  }

  // Voucher dihitung dari GABUNGAN tagihan seluruh hewan (setelah promo & golongan),
  // lalu dibagi proporsional. Satu kedatangan = satu kali pakai kode.
  const dasarPerPet = siap.map((s) => Math.max(0, s.subtotal - s.potonganNonVoucher));
  let voucherTotal = 0;
  if (voucherCode && dasarPerPet.some((d) => d > 0)) {
    const { data: vRow } = await supabase
      .from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id")
      .eq("code", voucherCode).maybeSingle();
    // Voucher bersasaran ikut diperiksa terhadap pemilik rombongan ini.
    const { data: custRomb } = rombongan.customerId
      ? await supabase.from("customers").select("category_id").eq("id", rombongan.customerId).maybeSingle()
      : { data: null };
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

  // Poin dipakai untuk SATU kedatangan, lalu dibagi proporsional ke nota tiap hewan
  // — perlakuannya persis voucher (permintaan Pak Aldi: poin di klinik harus sama
  // seperti di petshop).
  const poin = await bacaPoinPelanggan(supabase, rombongan.customerId ?? null);
  const dasarSetelahVoucher = dasarPerPet.map((d, i) => Math.max(0, d - voucherPerPet[i]));
  const poinDipakai = poinTerpakai(
    poinDiminta, poin.saldo, dasarSetelahVoucher.reduce((a, d) => a + d, 0),
  );
  const poinPerPet = bagiPotongan(dasarSetelahVoucher, poinDipakai * RUPIAH_PER_POIN);

  // TAHAP 2 — terbitkan notanya satu per satu.
  let poinTerpakaiRupiah = 0;
  let totalDibayarRombongan = 0;
  for (const [idx, s] of siap.entries()) {
    const { b, rows, subtotal, salespersonId } = s;
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
      },
      p_lines: barisUntukPosting(rows),
    });
    if (posted.error || !posted.invoiceNo) {
      dilewati.push(`${b.hewan}: ${parseClinicPostingError(posted.error)}`);
      continue;
    }
    const checkedOut = await supabase.rpc("set_visit_service_state", { p_visit_id: b.visitId, p_action: "checkout" });
    if (checkedOut.error) redirect(`${back}?error=${encodeURIComponent(checkedOut.error.message)}`);

    // Poin yang benar-benar terpakai dihitung dari nota yang BERHASIL terbit —
    // porsi hewan yang gagal tidak boleh ikut memotong saldo pelanggan.
    poinTerpakaiRupiah += poinPerPet[idx];
    totalDibayarRombongan += total;
    jumlahLunas++;
  }

  if (jumlahLunas > 0) {
    await catatPoinKlinik(supabase, {
      customerId: rombongan.customerId ?? null,
      ref: `Rombongan ${rombongan.customerName ?? ""}`.trim(),
      dipakai: Math.floor(poinTerpakaiRupiah / RUPIAH_PER_POIN),
      totalDibayar: totalDibayarRombongan,
      rupiahPerPoin: poin.rupiahPerPoin,
      saldoAwal: poin.saldo,
    });
  }

  if (rombongan.customerId) await recomputeCustomerTier(supabase, rombongan.customerId);

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
