"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { KATEGORI_BEBAN } from "./kategori";

const back = "/buku-besar/beban";

// Pencatatan beban tingkat pembukuan — Dr Beban / Cr Kas/Bank, langsung dijurnal.
export async function catatBeban(formData: FormData) {
  const supabase = await createClient();

  const branchId = String(formData.get("branch_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const kategori = String(formData.get("kategori") ?? "");
  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode") ?? "Tunai");

  if (!branchId) redirect(`${back}?error=${encodeURIComponent("Pilih cabang")}`);
  if (!kategori) redirect(`${back}?error=${encodeURIComponent("Pilih kategori beban")}`);
  if (jumlah <= 0) redirect(`${back}?error=${encodeURIComponent("Nominal harus lebih dari 0")}`);

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    tanggal,
    kategori,
    deskripsi: deskripsi || null,
    jumlah,
    metode_bayar: metode,
    bukti_url: null,
    created_by: user?.id ?? null,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  const bebanCode = KATEGORI_BEBAN[kategori] ?? "5401";
  const kasCode = metode === "Tunai" ? "1101" : "1102";
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
