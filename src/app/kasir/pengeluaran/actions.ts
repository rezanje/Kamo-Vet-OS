"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// Catat pengeluaran dari dunia kasir — cabang otomatis dari shift terbuka (bukan pilihan bebas).
export async function simpanPengeluaranKasir(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const kategori = String(formData.get("kategori") ?? "");
  const deskripsi = String(formData.get("deskripsi") ?? "");
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode_bayar") ?? "Tunai");

  if (!branchId) redirect(`/kasir/pengeluaran?error=${encodeURIComponent("Shift tidak valid")}`);
  if (!kategori) redirect(`/kasir/pengeluaran?error=${encodeURIComponent("Pilih kategori dulu")}`);
  if (jumlah <= 0) redirect(`/kasir/pengeluaran?error=${encodeURIComponent("Jumlah pengeluaran harus lebih dari 0")}`);

  const { data: { user } } = await supabase.auth.getUser();

  // Tempel ke shift berjalan biar pengeluaran tunai ikut ngurangin kas seharusnya saat tutup shift.
  const { data: shift } = await supabase
    .from("cashier_shifts").select("id")
    .eq("opened_by", user?.id ?? "").eq("status", "open").eq("shift_type", "petshop").maybeSingle();

  const { error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    tanggal: tanggal || undefined,
    kategori,
    deskripsi: deskripsi || null,
    jumlah,
    metode_bayar: metode,
    bukti_url: null, // ponytail: skip upload bukti, kolom dibiarkan null sesuai spec.
    shift_id: shift?.id ?? null,
    created_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/kasir/pengeluaran?error=${encodeURIComponent("Gagal menyimpan pengeluaran")}`);
  }

  // Accounting: Dr Beban, Cr Kas/Bank.
  const kategoriToCode: Record<string, string> = {
    "Listrik & Air": "5301",
    "Perlengkapan": "5302",
    "Transportasi": "5303",
    "Perawatan": "5304",
    "Operasional": "5401",
    "Lain-lain": "5401",
  };
  const bebanCode = kategoriToCode[kategori] ?? "5401";
  const kasCode = metode === "Tunai" ? "1101" : "1102";
  await postJournal(supabase, {
    tanggal: tanggal || new Date().toISOString().slice(0, 10),
    deskripsi: `Pengeluaran: ${deskripsi || kategori}`,
    source: "expense",
    sourceRef: null,
    branchId,
    lines: [
      { code: bebanCode, debit: jumlah, credit: 0 },
      { code: kasCode, debit: 0, credit: jumlah },
    ],
  });

  redirect("/kasir/pengeluaran?success=1");
}
