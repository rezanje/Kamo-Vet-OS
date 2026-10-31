"use server";
import { transactionDraftAck, assertDraftJournal } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

const kategoriToCode: Record<string, string> = {
  "Listrik & Air": "720002", "Perlengkapan": "740001", "Transportasi": "740003",
  "Perawatan": "740007", "Operasional": "760003", "Lain-lain": "760003",
};

export async function simpanPengeluaranKlinik(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const kategori = String(formData.get("kategori") ?? "");
  const deskripsi = String(formData.get("deskripsi") ?? "");
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode_bayar") ?? "Tunai");
  const back = "/klinik/pengeluaran";

  if (!branchId) redirect(`${back}?error=${encodeURIComponent("Cabang tidak valid — mulai shift klinik dulu")}`);
  if (!kategori) redirect(`${back}?error=${encodeURIComponent("Pilih kategori dulu")}`);
  if (jumlah <= 0) redirect(`${back}?error=${encodeURIComponent("Jumlah harus lebih dari 0")}`);

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  // Validate the destination before creating the expense. An unmapped branch
  // must not leave an unposted expense behind.
  let kasCode: string;
  try {
    kasCode = await kodeAkunBayar(supabase, metode, branchId);
  } catch (error) {
    const pesan = error instanceof Error ? error.message : "Rekening pembayaran cabang belum dipetakan";
    redirect(`${back}?error=${encodeURIComponent(pesan)}`);
  }

  const { data: { user } } = await supabase.auth.getUser();

  // Tempel ke shift klinik berjalan biar pengeluaran tunai ikut ngurangin kas seharusnya saat tutup shift.
  // Hanya laci milik sendiri di cabang pengeluaran ini — basis data menolak laci cabang lain.
  const { data: shift } = await supabase
    .from("cashier_shifts").select("id")
    .eq("opened_by", user?.id ?? "").eq("status", "open").eq("shift_type", "klinik")
    .eq("branch_id", branchId).maybeSingle();

  const { data: expense, error } = await supabase.from("expenses").insert({
    branch_id: branchId, tanggal, kategori,
    deskripsi: deskripsi || null, jumlah, metode_bayar: metode, bukti_url: null,
    shift_id: shift?.id ?? null, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !expense) redirect(`${back}?error=${encodeURIComponent("Gagal menyimpan pengeluaran")}`);

  const bebanCode = kategoriToCode[kategori] ?? "760003";
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pengeluaran klinik: ${deskripsi || kategori}`, source: "expense", sourceRef: expense!.id, branchId,
    lines: [{ code: bebanCode, debit: jumlah, credit: 0 }, { code: kasCode, debit: 0, credit: jumlah }],
  });

  await assertDraftJournal(supabase,{tanggal,source:"expense",sourceRef:expense!.id,branchId,lines:[{code:bebanCode,debit:jumlah,credit:0},{code:kasCode,debit:0,credit:jumlah}]});
  redirect(`${back}?success=1${transactionDraftAck(formData)}`);
}
