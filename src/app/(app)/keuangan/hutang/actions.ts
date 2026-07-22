"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// Bayar hutang usaha atas PO yang sudah Diterima.
// Jurnal: Dr Hutang Usaha (2101), Cr Kas/Bank.
export async function bayarHutang(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/hutang";

  const poId = String(formData.get("po_id") ?? "");
  const amount = Number(formData.get("amount")) || 0;
  const metode = String(formData.get("metode") ?? "Transfer");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!poId || amount <= 0) {
    redirect(`${back}?error=${encodeURIComponent("Nominal pembayaran tidak valid")}`);
  }

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, total, status, branch_id")
    .eq("id", poId).maybeSingle();
  if (!po) redirect(`${back}?error=${encodeURIComponent("PO tidak ditemukan")}`);
  if (po!.status !== "Diterima") redirect(`${back}?error=${encodeURIComponent("Hanya PO berstatus Diterima yang punya hutang")}`);

  const [{ data: pays }, { data: rets }] = await Promise.all([
    supabase.from("po_payments").select("amount").eq("po_id", poId),
    supabase.from("purchase_returns").select("total").eq("po_id", poId),
  ]);
  const sudahDibayar = (pays ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const totalRetur = (rets ?? []).reduce((a, r) => a + Number(r.total), 0);
  const sisa = Math.max(0, Number(po!.total) - sudahDibayar - totalRetur);

  if (sisa <= 0) redirect(`${back}?error=${encodeURIComponent("Hutang PO ini sudah lunas")}`);
  if (amount > sisa) redirect(`${back}?error=${encodeURIComponent(`Nominal melebihi sisa hutang (maks Rp ${Math.round(sisa).toLocaleString("id-ID")})`)}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error: payErr } = await supabase.from("po_payments").insert({
    po_id: poId, tanggal, amount, metode, catatan, created_by: user?.id ?? null,
  });
  if (payErr) redirect(`${back}?error=${encodeURIComponent(payErr.message)}`);

  const kasCode = metode === "Tunai" ? "1101" : "1102";
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pembayaran hutang ${po!.no_po ?? poId}`,
    source: "purchase-pay",
    sourceRef: po!.no_po ?? poId,
    branchId: po!.branch_id ?? null,
    lines: [
      { code: "2101", debit: amount, credit: 0 },
      { code: kasCode, debit: 0, credit: amount },
    ],
  });

  redirect(`${back}?success=1`);
}
