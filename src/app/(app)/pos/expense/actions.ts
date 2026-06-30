"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

export async function simpanExpense(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const kategori = String(formData.get("kategori") ?? "");
  const deskripsi = String(formData.get("deskripsi") ?? "");
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode_bayar") ?? "Tunai");

  if (!branchId) redirect(`/pos/expense?error=${encodeURIComponent("Pilih cabang dulu")}`);
  if (!kategori) redirect(`/pos/expense?error=${encodeURIComponent("Pilih kategori dulu")}`);
  if (jumlah <= 0) redirect(`/pos/expense?error=${encodeURIComponent("Jumlah pengeluaran harus lebih dari 0")}`);

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    tanggal: tanggal || undefined,
    kategori,
    deskripsi: deskripsi || null,
    jumlah,
    metode_bayar: metode,
    bukti_url: null, // ponytail: skip upload bukti, kolom dibiarkan null sesuai spec.
    created_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/pos/expense?error=${encodeURIComponent("Gagal menyimpan pengeluaran")}`);
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

  redirect("/pos/expense?success=1");
}
