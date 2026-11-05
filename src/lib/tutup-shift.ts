// Tutup shift kasir — SATU pintu untuk petshop, klinik, dan backoffice.
//
// Sebelumnya ada tiga salinan yang perilakunya berbeda-beda, dan bedanya tidak
// terlihat di layar mana pun — cuma muncul sebagai selisih kas yang salah:
//
// 1. Layar backoffice menutup shift APA PUN tanpa melihat jenisnya, dan selalu
//    memakai rumus petshop (baca tabel penjualan). Shift klinik yang ditutup dari
//    sana menghasilkan target kas = modal awal saja, jadi selisihnya sebesar
//    hampir seluruh kas klinik hari itu.
// 2. Tutup shift klinik ikut menghitung invoice yang sudah DIBATALKAN — void
//    hanya mengisi voided_at, status bayarnya tetap "Lunas".
// 3. Akun kas di-hardcode "110003", tidak lewat peta rekening, jadi cabang yang
//    rekeningnya dipetakan ulang tetap dijurnal ke kas pusat.
// 4. Status di-update tanpa syarat masih "open", jadi submit dobel bisa memposting
//    jurnal selisih dua kali.
//
// Semua rumusnya sekarang di sini, dan jenis shift menentukan sumber angkanya.

import { kodeAkunBayar } from "./kas-akun";
import { AKUN_PIUTANG_KARYAWAN } from "./kasbon";
import { jurnalTersimpan } from "./jurnal-guard";
import { postJournal } from "./posting";
import { cashExpenseTotal, cashVariance, expectedCash, invoiceCashRows, methodBreakdown } from "./shift-calc";
import { hariIniWIB } from "./tanggal";
import { salePaymentRows } from "./sale-payment-reporting";
import { gagalBacaUang } from "./baca-uang";
import { buangTransaksiTerputus, pesanTutupShift } from "./transaksi-terputus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const AKUN_SELISIH_KAS = "760002";
// Kas LEBIH bukan penghematan beban. Kalau dikreditkan ke 760002 (akun BEBAN), Laba
// Rugi menampilkannya sebagai beban minus dan laba bersih bisa melebihi laba kotor
// — pembacanya mengira toko untung besar padahal itu kas lebih yang belum jelas
// asalnya. Kas KURANG tetap beban/piutang kasir; itu memang kerugian perusahaan.
export const AKUN_KAS_LEBIH = "810004";

/**
 * Batas selisih kas fisik vs target per shift. Di atas ini hampir pasti salah ketik
 * (nol kebanyakan / kurang), bukan uang sungguhan — dan kalau diloloskan:
 * - kas LEBIH langsung jadi Pendapatan Lain-lain; satu ketikan "8098098980809"
 *   membuat dashboard melaporkan pendapatan Rp 8.113 M (31 Okt 2026);
 * - kas KURANG langsung jadi kasbon atas nama kasir dan dipotong dari gajinya.
 * Laci petshop/klinik tidak pernah selisih sebesar ini dalam satu shift; kejadian nyata
 * sebesar itu harus ditangani Owner/Keuangan, bukan dijurnal otomatis.
 */
export const BATAS_SELISIH_KAS = 5_000_000;

export const PESAN_KAS_FISIK_TIDAK_WAJAR =
  "Jumlah uang fisik yang diketik terlalu jauh dari wajar untuk satu laci — kemungkinan salah ketik "
  + "(nol kebanyakan atau kurang). Hitung ulang uangnya lalu ketik lagi. Shift belum ditutup. "
  + "Kalau angkanya memang benar, hubungi Owner/Keuangan.";

/**
 * Tolak angka kas fisik yang mustahil sebelum shift dikunci. Pesannya sengaja tidak
 * menyebut target kas, supaya aturan kasir buta tetap berlaku.
 */
export function cekKasFisikWajar(closing: number, expected: number): string | null {
  if (!Number.isFinite(closing) || closing < 0) return PESAN_KAS_FISIK_TIDAK_WAJAR;
  if (Math.abs(cashVariance(closing, expected)) > BATAS_SELISIH_KAS) return PESAN_KAS_FISIK_TIDAK_WAJAR;
  return null;
}

export type ShiftTutup = {
  id: string;
  shift_type: string | null;
  opening_balance: number;
  branch_id: string | null;
  opened_by: string | null;
  status: string;
};

export type HasilTutup =
  | { ok: true; expected: number; selisih: number; breakdown: Record<string, number>;
      /** Nama kasir kalau selisih kurang dibebankan sebagai piutangnya. */
      dibebankanKe: string | null }
  | { ok: false; error: string };


type KwitansiShift = {
  id: string; status: string; shift_id: string | null; void_shift_id: string | null;
  clinic_payment_receipt_parts?: { metode: string; amount: number }[] | null;
};

/** Laci hanya ditutup pemiliknya; laci nyangkut > 24 jam lewat tutup paksa supervisor. */
export const PESAN_LACI_ORANG_LAIN =
  "Laci ini milik kasir lain. Hanya pemilik laci yang bisa menghitung dan menutupnya; laci yang nyangkut lebih dari 24 jam ditutup paksa Owner/Admin dengan alasan.";

/** Pesan penjaga laci dari basis data tanpa kode teknis di depannya. */
export function pesanPenjagaLaci(message: string): string {
  return message.replace(/^[A-Z_]+:\s*/, "");
}

/** Pesan tunggal untuk semua sumber uang shift yang tidak terbaca. */
export const UANG_SHIFT_TIDAK_TERBACA =
  "Uang shift belum dapat dibaca lengkap. Muat ulang dan coba lagi — shift tidak ditutup supaya penerimaan yang nyata tidak terhitung sebagai kas lebih.";

/**
 * Bagian kwitansi klinik yang menggerakkan laci shift ini.
 *
 * Tabel yang memang belum ada (migrasi tagihan berjalan belum terpasang di lingkungan
 * ini) dikembalikan kosong, sama seperti sebelum fitur ini ada. Gangguan baca lain
 * TIDAK boleh menjadi nol: uang yang benar-benar diterima akan terbaca sebagai kas
 * lebih dan dijurnal ke pendapatan lain-lain.
 */
async function kwitansiKlinikRows(
  supabase: AnyClient, shiftId: string,
): Promise<{ total: number; metode_bayar: string }[]> {
  const { data, error } = await supabase
    .from("clinic_payment_receipts")
    .select("id, status, shift_id, void_shift_id, clinic_payment_receipt_parts(metode, amount)")
    .or(`shift_id.eq.${shiftId},void_shift_id.eq.${shiftId}`);
  if (gagalBacaUang(error)) throw new Error(UANG_SHIFT_TIDAK_TERBACA);
  if (error) return [];
  const rows: { total: number; metode_bayar: string }[] = [];
  for (const kwitansi of (data ?? []) as KwitansiShift[]) {
    const bagian = kwitansi.clinic_payment_receipt_parts ?? [];
    if (kwitansi.shift_id === shiftId) {
      for (const part of bagian) rows.push({ total: Number(part.amount) || 0, metode_bayar: part.metode });
    }
    if (kwitansi.void_shift_id === shiftId) {
      for (const part of bagian) rows.push({ total: -(Number(part.amount) || 0), metode_bayar: part.metode });
    }
  }
  return rows;
}

/** Uang masuk shift ini, dari sumber yang benar menurut jenis shiftnya. */
export async function pemasukanShift(
  supabase: AnyClient,
  shift: Pick<ShiftTutup, "id" | "shift_type">,
): Promise<{ total: number; metode_bayar: string }[]> {
  if (shift.shift_type === "klinik") {
    // Invoice yang dibatalkan TIDAK pernah jadi uang di laci.
    const { data: invoices, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, total, dp_amount, paid_status, metode_bayar, shift_cash_carry")
      .eq("shift_id", shift.id)
      .is("voided_at", null);
    if (invoiceError) throw new Error(UANG_SHIFT_TIDAK_TERBACA);

    const ids = ((invoices ?? []) as { id: string }[]).map((i) => i.id);
    const { data: pays, error: payError } = ids.length
      ? await supabase.from("invoice_payments").select("invoice_id, amount, metode, checkout_payment").in("invoice_id", ids)
      : { data: [] as { invoice_id: string; amount: number }[], error: null };
    if (payError) throw new Error(UANG_SHIFT_TIDAK_TERBACA);
    const susulan = new Map<string, number>();
    const originalParts: { total: number; metode_bayar: string }[] = [];
    const mixedInvoices = new Set<string>();
    for (const p of (pays ?? []) as { invoice_id: string; amount: number; metode?: string; checkout_payment?: boolean }[]) {
      if (p.checkout_payment && ids.includes(p.invoice_id)) {
        mixedInvoices.add(p.invoice_id);
        originalParts.push({ total: Number(p.amount), metode_bayar: p.metode ?? "Tunai" });
        continue;
      }
      susulan.set(p.invoice_id, (susulan.get(p.invoice_id) ?? 0) + Number(p.amount));
    }

    // Tagihan berjalan rawat inap: uangnya TIDAK masuk lewat kepala invoice, tapi lewat
    // kwitansi per kunjungan (boleh campuran metode, boleh beberapa kali). Tiap bagian
    // kwitansi yang diterima di shift ini menambah laci; kwitansi yang DIBATALKAN di shift
    // ini menguranginya. Kwitansi yang terbit dan dibatalkan di shift yang sama otomatis
    // saling meniadakan.
    //
    // Yang sengaja TIDAK dihitung: pemakaian uang muka pada tagihan (metode "Uang Muka").
    // Itu bukan uang masuk, hanya utang klinik ke pemilik yang berkurang — uangnya sudah
    // masuk laci pada shift saat kwitansinya dibuat.
    const kwitansiRows = await kwitansiKlinikRows(supabase, shift.id);

    return [...originalParts, ...kwitansiRows, ...invoiceCashRows(
      ((invoices ?? []) as {
        id: string; total: number; dp_amount: number; paid_status: string; metode_bayar: string;
        shift_cash_carry?: number | null;
      }[]).filter(i => !mixedInvoices.has(i.id)).map((i) => ({ ...i, dibayarSusulan: susulan.get(i.id) ?? 0 })),
    )];
  }

  const { data: sales, error } = await supabase
    .from("sales").select("no_struk, total, metode_bayar, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount)").eq("shift_id", shift.id);
  if (error) throw new Error(UANG_SHIFT_TIDAK_TERBACA);
  return salePaymentRows(sales ?? []);
}

/** Hitung target kas shift tanpa menutupnya — dipakai juga oleh force-close. */
export async function hitungShift(supabase: AnyClient, shift: ShiftTutup) {
  const [masuk, { data: expenses, error: expenseError }] = await Promise.all([
    pemasukanShift(supabase, shift),
    supabase.from("expenses").select("jumlah, metode_bayar").eq("shift_id", shift.id),
  ]);
  // Pengeluaran tunai mengurangi target laci. Kalau gagal dibaca lalu dianggap nol,
  // target kasnya terlalu tinggi dan kasir ditagih selisih yang tidak pernah ada.
  if (expenseError) throw new Error(UANG_SHIFT_TIDAK_TERBACA);
  const breakdown = methodBreakdown(masuk);
  const expected = expectedCash(
    Number(shift.opening_balance) || 0, breakdown, cashExpenseTotal(expenses ?? []),
  );
  return { breakdown, expected };
}

/**
 * Tutup shift + posting selisih kasnya.
 *
 * `closing` null = force-close (tutup paksa tanpa hitung fisik): selisih dipaksa 0
 * dan tidak ada jurnal, karena tidak ada kas fisik yang benar-benar dihitung.
 */
export async function tutupShift(
  supabase: AnyClient,
  o: { shift: ShiftTutup; closing: number | null },
): Promise<HasilTutup> {
  const { shift, closing } = o;
  if (shift.status !== "open") return { ok: false, error: "Shift sudah ditutup." };

  // Struk kasir yang terputus sebelum final menahan tutup shift selamanya kalau tidak
  // dibuang. Hanya yang belum memotong stok yang dibuang — lihat lib/transaksi-terputus.
  if (shift.shift_type !== "klinik") await buangTransaksiTerputus(supabase, shift.id);

  let calculation: Awaited<ReturnType<typeof hitungShift>>;
  try {
    calculation = await hitungShift(supabase, shift);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : UANG_SHIFT_TIDAK_TERBACA };
  }
  const { breakdown, expected } = calculation;
  if (closing !== null) {
    const tolak = cekKasFisikWajar(closing, expected);
    if (tolak) return { ok: false, error: tolak };
  }
  const selisih = closing === null ? 0 : cashVariance(closing, expected);

  // Syarat `status = open` ikut di UPDATE, bukan cuma dicek di baris terpisah:
  // dua submit yang berbarengan sama-sama lolos pengecekan lalu sama-sama menutup,
  // dan jurnal selisihnya jadi dobel.
  const { data: terupdate, error } = await supabase
    .from("cashier_shifts")
    .update({
      closing_balance: closing ?? expected,
      expected_cash: expected,
      selisih,
      closing_breakdown: breakdown,
      closed_at: new Date().toISOString(),
      status: "closed",
    })
    .eq("id", shift.id).eq("status", "open")
    .select("id");
  if (error) return { ok: false, error: pesanTutupShift(pesanPenjagaLaci(error.message)) };
  if (!terupdate || terupdate.length === 0) {
    return { ok: false, error: "Shift sudah ditutup barusan — tidak ditutup dua kali." };
  }

  let dibebankanKe: string | null = null;
  if (selisih !== 0) {
    // Kas cabang bisa dipetakan ke rekening lain; jangan paksa ke 110003 pusat.
    const kas = await kodeAkunBayar(supabase, "Tunai", shift.branch_id ?? null);
    const abs = Math.abs(selisih);

    // KAS KURANG → jadi piutang kasir kalau kasirnya bisa dikenali sebagai karyawan.
    // Utangnya ditulis sebagai kasbon berstatus Disetujui supaya ikut terpotong
    // otomatis dari gaji berikutnya — kalau cuma dijurnal ke 182001 tanpa dokumen,
    // tagihannya jadi hantu yang tidak pernah bisa ditagih sistem.
    // Kasbon dibuat lewat fungsi database yang memeriksa shift ini memang baru ditutup
    // dengan kas kurang — akun kasir tidak lagi boleh menulis kasbon langsung.
    let kasbon: { advance_id: string; employee_name: string } | null = null;
    if (selisih < 0) {
      const { data: rows, error: shortageError } = await supabase.rpc("record_shift_cash_shortage", { p_shift_id: shift.id });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!shortageError && row?.advance_id) kasbon = row as { advance_id: string; employee_name: string };
    }

    if (kasbon) {
      await postJournal(supabase, {
        tanggal: hariIniWIB(),
        deskripsi: `Selisih kas kurang — ditanggung ${kasbon.employee_name}`,
        source: "shift", sourceRef: shift.id, branchId: shift.branch_id ?? null,
        lines: [
          { code: AKUN_PIUTANG_KARYAWAN, debit: abs, credit: 0 },
          { code: kas, debit: 0, credit: abs },
        ],
      });
      // postJournal menelan error. Utang tanpa jurnal lebih buruk daripada gagal
      // terang-terangan, jadi dokumennya dibatalkan kalau jurnalnya tidak ada.
      if (await jurnalTersimpan(supabase, "shift", shift.id)) {
        dibebankanKe = kasbon.employee_name;
      } else {
        await supabase.rpc("cancel_shift_cash_shortage", { p_shift_id: shift.id });
      }
    }

    if (!dibebankanKe) {
      // Kas LEBIH, atau kasirnya belum tertaut ke data karyawan. Tetap dijurnal ke
      // Selisih Kas — kalau dilewati, kas buku besar berbeda dari kas fisik selamanya.
      await postJournal(supabase, {
        tanggal: hariIniWIB(),
        deskripsi: (selisih > 0 ? "Kelebihan kas tutup shift" : "Selisih kas tutup shift")
          + (shift.shift_type === "klinik" ? " klinik" : ""),
        source: "shift",
        sourceRef: shift.id,
        branchId: shift.branch_id ?? null,
        // kurang: Dr Selisih Kas / Cr Kas · lebih: Dr Kas / Cr Pendapatan Lain-lain
        lines: selisih < 0
          ? [{ code: AKUN_SELISIH_KAS, debit: abs, credit: 0 }, { code: kas, debit: 0, credit: abs }]
          : [{ code: kas, debit: abs, credit: 0 }, { code: AKUN_KAS_LEBIH, debit: 0, credit: abs }],
      });
    }
  }

  return { ok: true, expected, selisih, breakdown, dibebankanKe };
}

const KOLOM_SHIFT = "id, shift_type, opening_balance, branch_id, opened_by, status";

/** Baca shift lengkap untuk ditutup. `jenis` mengunci layar ke jenis shiftnya. */
export async function bacaShift(
  supabase: AnyClient, shiftId: string, jenis?: "petshop" | "klinik",
): Promise<ShiftTutup | null> {
  let q = supabase.from("cashier_shifts").select(KOLOM_SHIFT).eq("id", shiftId);
  if (jenis) q = q.eq("shift_type", jenis);
  const { data } = await q.maybeSingle();
  return (data ?? null) as ShiftTutup | null;
}

