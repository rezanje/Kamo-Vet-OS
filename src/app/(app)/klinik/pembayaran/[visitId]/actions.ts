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
  const total = Math.max(0, subtotal - discount);

  const paidStatus = String(formData.get("paid_status") ?? "Lunas");
  const dpAmount = paidStatus === "DP" ? Number(formData.get("dp_amount")) || 0 : 0;
  const dpDate = paidStatus === "DP" ? String(formData.get("dp_date") ?? "") || null : null;
  const paidAt = paidStatus === "Lunas" ? new Date().toISOString() : null;

  // ponytail: re-bayar replaces the previous invoice for this visit (unique visit_id).
  await supabase.from("invoices").delete().eq("visit_id", visitId);

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({ visit_id: visitId, subtotal, discount, total, dp_amount: dpAmount, dp_date: dpDate, paid_status: paidStatus, paid_at: paidAt })
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
