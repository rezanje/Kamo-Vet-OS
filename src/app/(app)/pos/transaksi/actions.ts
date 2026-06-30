"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type CartLine = { item_id: string | null; nama: string; qty: number; harga: number; target_species: string };

const POIN_PER_RUPIAH = 1000; // 1 poin / Rp1.000

export async function checkoutSale(formData: FormData) {
  const supabase = await createClient();

  const branchId = String(formData.get("branchId") ?? "");
  const customerId = String(formData.get("customerId") ?? "") || null;
  const petId = String(formData.get("petId") ?? "") || null;
  const metode = String(formData.get("metode") ?? "Tunai");
  const discount = Number(formData.get("discount")) || 0;
  const bayar = Number(formData.get("bayar")) || 0;

  if (!branchId) redirect(`/pos/transaksi?error=${encodeURIComponent("Pilih cabang dulu")}`);

  let cart: CartLine[] = [];
  try {
    cart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    cart = [];
  }
  const rows = cart.filter((l) => l.nama?.trim() && Number(l.qty) > 0);
  if (rows.length === 0) redirect(`/pos/transaksi?error=${encodeURIComponent("Keranjang kosong")}`);

  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
  const total = Math.max(0, subtotal - discount);
  const kembali = Math.max(0, bayar - total);

  const { data: { user } } = await supabase.auth.getUser();

  const now = new Date();
  const prefix = `POS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const { count } = await supabase.from("sales").select("*", { count: "exact", head: true }).like("no_struk", `${prefix}-%`);
  const noStruk = `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const poin = customerId ? Math.floor(total / POIN_PER_RUPIAH) : 0;

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      branch_id: branchId, customer_id: customerId, pet_id: petId, no_struk: noStruk,
      subtotal, discount, total, metode_bayar: metode, bayar, kembali, poin_earned: poin,
      cashier_id: user?.id ?? null,
    })
    .select("id").single();
  if (saleErr || !sale) redirect(`/pos/transaksi?error=${encodeURIComponent(saleErr?.message ?? "Gagal simpan transaksi")}`);

  const { error: itErr } = await supabase.from("sale_items").insert(
    rows.map((l) => ({ sale_id: sale!.id, item_id: l.item_id, nama: l.nama, qty: l.qty, harga: l.harga, target_species: l.target_species }))
  );
  if (itErr) redirect(`/pos/transaksi?error=${encodeURIComponent(itErr.message)}`);

  // §1.4: poin masuk ledger + saldo berjalan, total_spending pelanggan naik.
  if (customerId && poin > 0) {
    const { data: cust } = await supabase.from("customers").select("points, total_spending").eq("id", customerId).single();
    const saldo = (cust?.points ?? 0) + poin;
    await supabase.from("customers").update({ points: saldo, total_spending: (Number(cust?.total_spending) || 0) + total }).eq("id", customerId);
    await supabase.from("point_ledger").insert({ customer_id: customerId, delta: poin, saldo, ref: noStruk, description: `Transaksi ${noStruk}` });
  }

  redirect(`/pos/struk/${sale!.id}`);
}
