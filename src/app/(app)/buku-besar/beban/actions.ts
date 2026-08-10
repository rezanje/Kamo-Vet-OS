"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { parseLampiran } from "@/lib/dokumen";
import { KATEGORI_BEBAN } from "./kategori";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";

const back = "/buku-besar/beban";

// Pencatatan beban tingkat pembukuan — Dr Beban / Cr Kas/Bank, langsung dijurnal.
export async function catatBeban(formData: FormData) {
  const supabase = await createClient();

  const branchId = String(formData.get("branch_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const kategori = String(formData.get("kategori") ?? "");
  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode") ?? "Tunai");

  if (!branchId) redirect(`${back}?error=${encodeURIComponent("Pilih cabang")}`);
  if (!kategori) redirect(`${back}?error=${encodeURIComponent("Pilih kategori beban")}`);
  if (jumlah <= 0) redirect(`${back}?error=${encodeURIComponent("Nominal harus lebih dari 0")}`);

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  // Aturan sama dgn Pengeluaran di modul Persediaan: kas keluar tanpa bukti tidak
  // bisa diaudit. Kalau jalur ini dibiarkan bebas, aturannya cuma jadi hiasan.
  const lampiran = parseLampiran(formData.get("lampiran"));
  if (lampiran.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Lampiran bukti wajib diisi sebelum beban bisa disimpan")}`);
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { data: expense, error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    tanggal,
    kategori,
    deskripsi: deskripsi || null,
    jumlah,
    metode_bayar: metode,
    bukti_url: lampiran[0].path,
    created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !expense) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal menyimpan beban")}`);

  await supabase.from("document_attachments").insert(
    lampiran.map((l) => ({ ...l, modul: "pengeluaran", ref_id: expense!.id, uploaded_by: user?.id ?? null })),
  );

  const bebanCode = KATEGORI_BEBAN[kategori] ?? "5401";
  const kasCode = await kodeAkunBayar(supabase, metode, branchId, String(formData.get("account_id") ?? "").trim() || null);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Beban ${kategori}${deskripsi ? " — " + deskripsi : ""}`,
    source: "expense",
    sourceRef: null,
    branchId,
    lines: [
      { code: bebanCode, debit: jumlah, credit: 0 },
      { code: kasCode, debit: 0, credit: jumlah },
    ],
  });

  redirect(`${back}?success=1`);
}
