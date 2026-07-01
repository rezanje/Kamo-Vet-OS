"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// Rekonsiliasi bank (saldo-level). Bandingkan saldo buku Bank (1102) dgn saldo rekening
// koran, catat biaya adm / bunga sbg jurnal penyesuaian supaya buku sinkron ke bank.
export async function prosesRekonsiliasi(formData: FormData) {
  const supabase = await createClient();

  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const saldoBank = Number(formData.get("saldo_bank")) || 0;
  const biayaAdm = Number(formData.get("biaya_adm")) || 0;
  const bunga = Number(formData.get("bunga")) || 0;
  const catatan = String(formData.get("catatan") ?? "") || null;

  // saldo buku Bank 1102 dari ledger (saat ini).
  const { data: acc } = await supabase.from("coa_accounts").select("id").eq("code", "1102").maybeSingle();
  let saldoBuku = 0;
  if (acc) {
    const { data: lines } = await supabase.from("journal_lines").select("debit, credit").eq("account_id", acc.id);
    saldoBuku = (lines ?? []).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
  }
  const adjusted = saldoBuku + bunga - biayaAdm;
  const selisih = saldoBank - adjusted;

  await supabase.from("bank_reconciliations").insert({
    tanggal, saldo_buku: saldoBuku, saldo_bank: saldoBank, biaya_adm: biayaAdm, bunga, selisih, catatan,
  });

  // Jurnal penyesuaian → buku ikut bergerak ke arah bank.
  if (biayaAdm > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: "Biaya administrasi bank", source: "bank-rec", branchId: null,
      lines: [{ code: "5501", debit: biayaAdm, credit: 0 }, { code: "1102", debit: 0, credit: biayaAdm }],
    });
  }
  if (bunga > 0) {
    await postJournal(supabase, {
      tanggal, deskripsi: "Pendapatan bunga bank", source: "bank-rec", branchId: null,
      lines: [{ code: "1102", debit: bunga, credit: 0 }, { code: "4301", debit: 0, credit: bunga }],
    });
  }

  redirect("/keuangan/rekonsiliasi?success=1");
}
