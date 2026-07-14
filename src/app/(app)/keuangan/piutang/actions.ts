"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// Terima pelunasan piutang atas invoice klinik (DP / Belum Lunas).
// Jurnal: Dr Kas/Bank, Cr Piutang Usaha (1201). Lunas penuh → invoice Lunas, visit Selesai.
export async function terimaPelunasan(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/piutang";

  const invoiceId = String(formData.get("invoice_id") ?? "");
  const amount = Number(formData.get("amount")) || 0;
  const metode = String(formData.get("metode") ?? "Tunai");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!invoiceId || amount <= 0) {
    redirect(`${back}?error=${encodeURIComponent("Nominal pelunasan tidak valid")}`);
  }

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, invoice_no, total, dp_amount, paid_status, visit_id")
    .eq("id", invoiceId).is("voided_at", null).maybeSingle();
  if (!inv) redirect(`${back}?error=${encodeURIComponent("Invoice tidak ditemukan")}`);
  if (inv!.paid_status === "Lunas") redirect(`${back}?error=${encodeURIComponent("Invoice sudah lunas")}`);

  const { data: pays } = await supabase
    .from("invoice_payments").select("amount").eq("invoice_id", invoiceId);
  const sudahDibayar = Number(inv!.dp_amount) + (pays ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const sisa = Math.max(0, Number(inv!.total) - sudahDibayar);

  if (sisa <= 0) redirect(`${back}?error=${encodeURIComponent("Piutang invoice ini sudah nol")}`);
  if (amount > sisa) redirect(`${back}?error=${encodeURIComponent(`Nominal melebihi sisa piutang (maks Rp ${Math.round(sisa).toLocaleString("id-ID")})`)}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error: payErr } = await supabase.from("invoice_payments").insert({
    invoice_id: invoiceId, tanggal, amount, metode, catatan, created_by: user?.id ?? null,
  });
  if (payErr) redirect(`${back}?error=${encodeURIComponent(payErr.message)}`);

  const { data: v } = await supabase.from("visits").select("branch_id").eq("id", inv!.visit_id).maybeSingle();

  // Jurnal: kas masuk, piutang berkurang.
  const kasCode = metode === "Tunai" ? "1101" : "1102";
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pelunasan piutang ${inv!.invoice_no}`,
    source: "klinik-ar",
    sourceRef: inv!.invoice_no,
    branchId: v?.branch_id ?? null,
    lines: [
      { code: kasCode, debit: amount, credit: 0 },
      { code: "1201", debit: 0, credit: amount },
    ],
  });

  // Lunas penuh → tutup invoice + visit.
  if (amount >= sisa) {
    await supabase.from("invoices")
      .update({ paid_status: "Lunas", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
    await supabase.from("visits").update({ status: "Selesai" }).eq("id", inv!.visit_id);
  }

  redirect(`${back}?success=1`);
}
