"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canApprove, canTransitionRequest } from "@/lib/stock-recon";

type ItemInput = { nama: string; qty_diminta: number };

export async function buatPermintaan(formData: FormData) {
  const supabase = await createClient();

  const from_branch_id = String(formData.get("from_branch_id") ?? "");
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[];
  } catch {
    items = [];
  }
  // hanya baris dengan nama terisi yang dipakai.
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!from_branch_id || !to_warehouse_id || items.length === 0) {
    redirect("/pos/permintaan/baru?error=" + encodeURIComponent("Cabang, gudang, dan minimal 1 item wajib diisi."));
  }

  // no_request = PRM-YYYYMMDD-NNNN (urutan hari ini +1, padded 4). Today 2026-07-01.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ymd = `${y}${m}${d}`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("stock_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfDay.toISOString());
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const no_request = `PRM-${ymd}-${seq}`;

  const { data: req, error: reqErr } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id, to_warehouse_id, catatan })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/pos/permintaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  const rows = items.map((it) => ({
    request_id: (req as { id: string }).id,
    nama: String(it.nama).slice(0, 160),
    qty_diminta: Number(it.qty_diminta) || 0,
  }));
  await supabase.from("stock_request_items").insert(rows);

  revalidatePath("/pos/permintaan");
  redirect("/pos/permintaan?success=1");
}

export async function updateRequestStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));

  const { data: req } = await supabase.from("stock_requests").select("status").eq("id", id).single();
  if (!req) redirect(`/pos/permintaan?error=${encodeURIComponent("Permintaan tidak ditemukan")}`);

  // Addendum §5: flow linear — Menunggu → Disetujui → Dikirim → Selesai / Ditolak (terminal).
  if (!canTransitionRequest(req!.status, status)) {
    redirect(`/pos/permintaan?error=${encodeURIComponent(`Transisi ${req!.status} → ${status} tidak valid`)}`);
  }

  // approval/penolakan hanya Kepala Gudang / Manajer (role check server-side, bukan UI).
  const { data: { user } } = await supabase.auth.getUser();
  const isApproval = status === "Disetujui" || status === "Ditolak";
  if (isApproval) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
    if (!canApprove(me?.role ?? "")) {
      redirect(`/pos/permintaan?error=${encodeURIComponent("Hanya Kepala Gudang / Manajer yang bisa menyetujui atau menolak")}`);
    }
  }

  await supabase
    .from("stock_requests")
    .update(status === "Disetujui" ? { status, approved_by: user?.id ?? null } : { status })
    .eq("id", id);
  revalidatePath("/pos/permintaan");
}
