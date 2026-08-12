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
// 3. Akun kas di-hardcode "1101", tidak lewat peta rekening, jadi cabang yang
//    rekeningnya dipetakan ulang tetap dijurnal ke kas pusat.
// 4. Status di-update tanpa syarat masih "open", jadi submit dobel bisa memposting
//    jurnal selisih dua kali.
//
// Semua rumusnya sekarang di sini, dan jenis shift menentukan sumber angkanya.

import { kodeAkunBayar } from "./kas-akun";
import { AKUN_PIUTANG_KARYAWAN, ALASAN_SELISIH_KAS } from "./kasbon";
import { jurnalTersimpan } from "./jurnal-guard";
import { postJournal } from "./posting";
import { cashExpenseTotal, cashVariance, expectedCash, invoiceCashRows, methodBreakdown } from "./shift-calc";
import { hariIniWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const AKUN_SELISIH_KAS = "5901";

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

/** Uang masuk shift ini, dari sumber yang benar menurut jenis shiftnya. */
export async function pemasukanShift(
  supabase: AnyClient,
  shift: Pick<ShiftTutup, "id" | "shift_type">,
): Promise<{ total: number; metode_bayar: string }[]> {
  if (shift.shift_type === "klinik") {
    // Invoice yang dibatalkan TIDAK pernah jadi uang di laci.
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, total, dp_amount, paid_status, metode_bayar")
      .eq("shift_id", shift.id)
      .is("voided_at", null);

    const ids = ((invoices ?? []) as { id: string }[]).map((i) => i.id);
    const { data: pays } = ids.length
      ? await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", ids)
      : { data: [] as { invoice_id: string; amount: number }[] };
    const susulan = new Map<string, number>();
    for (const p of (pays ?? []) as { invoice_id: string; amount: number }[]) {
      susulan.set(p.invoice_id, (susulan.get(p.invoice_id) ?? 0) + Number(p.amount));
    }

    return invoiceCashRows(
      ((invoices ?? []) as {
        id: string; total: number; dp_amount: number; paid_status: string; metode_bayar: string;
      }[]).map((i) => ({ ...i, dibayarSusulan: susulan.get(i.id) ?? 0 })),
    );
  }

  const { data: sales } = await supabase
    .from("sales").select("total, metode_bayar").eq("shift_id", shift.id);
  return (sales ?? []) as { total: number; metode_bayar: string }[];
}

/** Hitung target kas shift tanpa menutupnya — dipakai juga oleh force-close. */
export async function hitungShift(supabase: AnyClient, shift: ShiftTutup) {
  const [masuk, { data: expenses }] = await Promise.all([
    pemasukanShift(supabase, shift),
    supabase.from("expenses").select("jumlah, metode_bayar").eq("shift_id", shift.id),
  ]);
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

  const { breakdown, expected } = await hitungShift(supabase, shift);
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
  if (error) return { ok: false, error: error.message };
  if (!terupdate || terupdate.length === 0) {
    return { ok: false, error: "Shift sudah ditutup barusan — tidak ditutup dua kali." };
  }

  let dibebankanKe: string | null = null;
  if (selisih !== 0) {
    // Kas cabang bisa dipetakan ke rekening lain; jangan paksa ke 1101 pusat.
    const kas = await kodeAkunBayar(supabase, "Tunai", shift.branch_id ?? null);
    const abs = Math.abs(selisih);

    // KAS KURANG → jadi piutang kasir kalau kasirnya bisa dikenali sebagai karyawan.
    // Utangnya ditulis sebagai kasbon berstatus Disetujui supaya ikut terpotong
    // otomatis dari gaji berikutnya — kalau cuma dijurnal ke 1203 tanpa dokumen,
    // tagihannya jadi hantu yang tidak pernah bisa ditagih sistem.
    const karyawan = selisih < 0 ? await karyawanShift(supabase, shift.opened_by) : null;

    if (selisih < 0 && karyawan) {
      const { data: adv, error } = await supabase.from("cash_advances").insert({
        employee_id: karyawan.id,
        tanggal: hariIniWIB(),
        jumlah: abs,
        tenor_bulan: 1,
        status: "Disetujui",
        alasan: `${ALASAN_SELISIH_KAS} ${shift.id.slice(0, 8)}`,
        disbursed_at: new Date().toISOString(),
      }).select("id").single();

      if (!error && adv) {
        await postJournal(supabase, {
          tanggal: hariIniWIB(),
          deskripsi: `Selisih kas kurang — ditanggung ${karyawan.nama}`,
          source: "shift", sourceRef: shift.id, branchId: shift.branch_id ?? null,
          lines: [
            { code: AKUN_PIUTANG_KARYAWAN, debit: abs, credit: 0 },
            { code: kas, debit: 0, credit: abs },
          ],
        });
        // postJournal menelan error. Utang tanpa jurnal lebih buruk daripada gagal
        // terang-terangan, jadi dokumennya dibatalkan kalau jurnalnya tidak ada.
        if (await jurnalTersimpan(supabase, "shift", shift.id)) {
          dibebankanKe = karyawan.nama;
        } else {
          await supabase.from("cash_advances").delete().eq("id", adv.id);
        }
      }
    }

    if (!dibebankanKe) {
      // Kas LEBIH, atau kasirnya belum tertaut ke data karyawan. Tetap dijurnal ke
      // Selisih Kas — kalau dilewati, kas buku besar berbeda dari kas fisik selamanya.
      await postJournal(supabase, {
        tanggal: hariIniWIB(),
        deskripsi: shift.shift_type === "klinik" ? "Selisih kas tutup shift klinik" : "Selisih kas tutup shift",
        source: "shift",
        sourceRef: shift.id,
        branchId: shift.branch_id ?? null,
        // kurang: Dr Selisih Kas / Cr Kas · lebih: Dr Kas / Cr Selisih Kas
        lines: selisih < 0
          ? [{ code: AKUN_SELISIH_KAS, debit: abs, credit: 0 }, { code: kas, debit: 0, credit: abs }]
          : [{ code: kas, debit: abs, credit: 0 }, { code: AKUN_SELISIH_KAS, debit: 0, credit: abs }],
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

/**
 * Kasir shift sebagai KARYAWAN. Tidak semua akun login punya kartu karyawan
 * (`employees.profile_id` boleh kosong) — kalau tidak tertaut, selisihnya tidak
 * bisa dibebankan ke siapa pun dan tetap masuk Selisih Kas.
 */
async function karyawanShift(
  supabase: AnyClient, openedBy: string | null,
): Promise<{ id: string; nama: string } | null> {
  if (!openedBy) return null;
  const { data } = await supabase
    .from("employees").select("id, nama")
    .eq("profile_id", openedBy).eq("status", "Aktif").maybeSingle();
  return (data ?? null) as { id: string; nama: string } | null;
}
