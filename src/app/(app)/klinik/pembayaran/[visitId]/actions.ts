"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Line = { deskripsi: string; qty: number; harga: number };

export async function bayarVisit(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;

  let items: Line[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    items = [];
  }
  const rows = items
    .filter((l) => l.deskripsi?.trim())
    .map((l) => ({ deskripsi: l.deskripsi.trim(), qty: Number(l.qty) > 0 ? Number(l.qty) : 1, harga: Number(l.harga) || 0 }));

  if (rows.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Minimal 1 item tagihan")}`);
  }

  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
  const discount = Number(formData.get("discount")) || 0;
  const dpp = Math.max(0, subtotal - discount);
  const tax = Math.round(dpp * 0.11); // PPN 11% di atas DPP
  const total = dpp + tax;

  const paidStatus = String(formData.get("paid_status") ?? "Lunas");
  const metode = String(formData.get("metode_bayar") ?? "Tunai");
  const dpAmount = paidStatus === "DP" ? Number(formData.get("dp_amount")) || 0 : 0;
  const dpDate = paidStatus === "DP" ? String(formData.get("dp_date") ?? "") || null : null;
  const paidAt = paidStatus === "Lunas" ? new Date().toISOString() : null;

  // ponytail: re-bayar replaces the previous invoice for this visit (unique visit_id).
  await supabase.from("invoices").delete().eq("visit_id", visitId);

  // Nomor invoice INV-YYYYMM-NNNN, urut per bulan.
  // ponytail: count+1 bisa race di concurrency tinggi; unique constraint jadi backstop.
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { count } = await supabase
    .from("invoices").select("*", { count: "exact", head: true }).like("invoice_no", `${prefix}-%`);
  const invoiceNo = `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({ visit_id: visitId, invoice_no: invoiceNo, subtotal, discount, tax, total, dp_amount: dpAmount, dp_date: dpDate, paid_status: paidStatus, metode_bayar: metode, paid_at: paidAt })
    .select("id").single();
  if (invErr || !inv) {
    redirect(`${back}?error=${encodeURIComponent(invErr?.message ?? "Gagal simpan invoice")}`);
  }

  const { error: itErr } = await supabase
    .from("invoice_items")
    .insert(rows.map((l) => ({ invoice_id: inv!.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga })));
  if (itErr) {
    redirect(`${back}?error=${encodeURIComponent(itErr.message)}`);
  }

  await supabase.from("visits").update({ status: "Selesai" }).eq("id", visitId);
  redirect("/klinik/antrian?success=bayar");
}
