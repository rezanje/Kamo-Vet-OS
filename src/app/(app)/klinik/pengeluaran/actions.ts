"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

const kategoriToCode: Record<string, string> = {
  "Listrik & Air": "5301", "Perlengkapan": "5302", "Transportasi": "5303",
  "Perawatan": "5304", "Operasional": "5401", "Lain-lain": "5401",
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

  const { data: { user } } = await supabase.auth.getUser();

  // Tempel ke shift klinik berjalan biar pengeluaran tunai ikut ngurangin kas seharusnya saat tutup shift.
  const { data: shift } = await supabase
    .from("cashier_shifts").select("id")
    .eq("opened_by", user?.id ?? "").eq("status", "open").eq("shift_type", "klinik").maybeSingle();

  const { error } = await supabase.from("expenses").insert({
    branch_id: branchId, tanggal, kategori,
    deskripsi: deskripsi || null, jumlah, metode_bayar: metode, bukti_url: null,
    shift_id: shift?.id ?? null, created_by: user?.id ?? null,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent("Gagal menyimpan pengeluaran")}`);

  const bebanCode = kategoriToCode[kategori] ?? "5401";
  const kasCode = await kodeAkunBayar(supabase, metode, branchId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pengeluaran klinik: ${deskripsi || kategori}`, source: "expense", sourceRef: null, branchId,
    lines: [{ code: bebanCode, debit: jumlah, credit: 0 }, { code: kasCode, debit: 0, credit: jumlah }],
  });

  redirect(`${back}?success=1`);
}
