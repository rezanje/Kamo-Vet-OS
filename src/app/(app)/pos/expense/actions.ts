"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { parseLampiran } from "@/lib/dokumen";

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

  // Pengeluaran WAJIB berlampir bukti — tanpa nota/bukti transfer, kas keluar tidak
  // bisa diaudit dan itu justru lubang paling gampang disalahgunakan.
  const lampiran = parseLampiran(formData.get("lampiran"));
  if (lampiran.length === 0) {
    redirect(`/pos/expense?error=${encodeURIComponent("Lampiran bukti wajib diisi sebelum pengeluaran bisa disimpan")}`);
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { data: expense, error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    tanggal: tanggal || undefined,
    kategori,
    deskripsi: deskripsi || null,
    jumlah,
    metode_bayar: metode,
    bukti_url: lampiran[0].path,
    created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !expense) {
    redirect(`/pos/expense?error=${encodeURIComponent("Gagal menyimpan pengeluaran")}`);
  }

  await supabase.from("document_attachments").insert(
    lampiran.map((l) => ({ ...l, modul: "pengeluaran", ref_id: expense!.id, uploaded_by: user?.id ?? null })),
  );

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
  const kasCode = await kodeAkunBayar(supabase, metode, branchId);
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
