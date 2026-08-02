"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// Rekonsiliasi bank (saldo-level) PER REKENING: bandingkan saldo buku rekening terpilih
// dengan saldo rekening korannya, catat biaya adm / bunga sbg jurnal penyesuaian.
export async function prosesRekonsiliasi(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/rekonsiliasi";
  const gagal = (msg: string) => redirect(`${back}?error=${encodeURIComponent(msg)}`);

  const accountId = String(formData.get("account_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const saldoBank = Number(formData.get("saldo_bank")) || 0;
  const biayaAdm = Number(formData.get("biaya_adm")) || 0;
  const bunga = Number(formData.get("bunga")) || 0;
  const catatan = String(formData.get("catatan") ?? "") || null;

  if (!accountId) gagal("Pilih rekening yang direkonsiliasi");

  const { data: rek } = await supabase
    .from("cash_accounts").select("id, nama, coa_code").eq("id", accountId).maybeSingle();
  if (!rek) gagal("Rekening tidak ditemukan");

  // Saldo buku rekening terpilih (bukan lagi akun 1102 mati).
  const { data: acc } = await supabase
    .from("coa_accounts").select("id").eq("code", rek!.coa_code).maybeSingle();
  let saldoBuku = 0;
  if (acc) {
    const { data: lines } = await supabase.from("journal_lines").select("debit, credit").eq("account_id", acc.id);
    saldoBuku = (lines ?? []).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
  }
  const adjusted = saldoBuku + bunga - biayaAdm;
  const selisih = saldoBank - adjusted;

  await supabase.from("bank_reconciliations").insert({
    tanggal, cash_account_id: accountId,
    saldo_buku: saldoBuku, saldo_bank: saldoBank, biaya_adm: biayaAdm, bunga, selisih, catatan,
  });

  // Jurnal penyesuaian → buku ikut bergerak ke arah bank.
  if (biayaAdm > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: `Biaya administrasi bank — ${rek!.nama}`, source: "bank-rec", branchId: null,
      lines: [{ code: "5501", debit: biayaAdm, credit: 0 }, { code: rek!.coa_code, debit: 0, credit: biayaAdm }],
    });
  }
  if (bunga > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: `Pendapatan bunga bank — ${rek!.nama}`, source: "bank-rec", branchId: null,
      lines: [{ code: rek!.coa_code, debit: bunga, credit: 0 }, { code: "4301", debit: 0, credit: bunga }],
    });
  }

  redirect(`${back}?success=1&rek=${accountId}`);
}
