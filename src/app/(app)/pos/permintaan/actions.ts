"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canApprove, canTransitionRequest } from "@/lib/stock-recon";
import { loadMasterPermintaan, parseBarisInput, siapkanBaris } from "@/lib/permintaan";
import { formatNomor, urutanBerikutnya } from "@/lib/no-dokumen";

export async function buatPermintaan(formData: FormData) {
  const supabase = await createClient();

  const from_branch_id = String(formData.get("from_branch_id") ?? "");
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!from_branch_id || !to_warehouse_id) {
    redirect("/pos/permintaan/baru?error=" + encodeURIComponent("Cabang dan gudang tujuan wajib diisi."));
  }

  // Satuan & jenis barang ditentukan ulang dari master — kiriman klien tidak dipercaya.
  const input = parseBarisInput(formData.get("items"));
  const master = await loadMasterPermintaan(supabase, input.map((b) => String(b.item_id ?? "")));
  const { rows: baris, error: barisErr } = siapkanBaris(input, master);
  if (barisErr) redirect("/pos/permintaan/baru?error=" + encodeURIComponent(barisErr));

  // no_request = PRM-YYYYMMDD-NNNN, dilanjutkan dari nomor tertinggi hari itu.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefixPrm = `PRM-${y}${m}${d}-`;
  const no_request = formatNomor(prefixPrm, await urutanBerikutnya(supabase, {
    table: "stock_requests", column: "no_request", prefix: prefixPrm, pad: 4,
  }), 4);

  const { data: req, error: reqErr } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id, to_warehouse_id, catatan })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/pos/permintaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  await supabase.from("stock_request_items").insert(
    baris.map((b) => ({ ...b, request_id: (req as { id: string }).id })),
  );

  revalidatePath("/pos/permintaan");
  redirect("/pos/permintaan?success=1");
}

// Setujui dgn penyesuaian qty (stok DC tidak selalu cukup). Baris yang tidak
// dikirim sama sekali cukup diisi 0 — permintaannya tetap tercatat utuh.
export async function setujuiPermintaan(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const kembali = `/pos/permintaan/${id}`;

  const { data: req } = await supabase.from("stock_requests").select("status").eq("id", id).maybeSingle();
  if (!req) redirect(`/pos/permintaan?error=${encodeURIComponent("Permintaan tidak ditemukan")}`);
  if (!canTransitionRequest(req!.status, "Disetujui")) {
    redirect(`${kembali}?error=${encodeURIComponent(`Permintaan sudah berstatus ${req!.status}`)}`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!canApprove(me?.role ?? "")) {
    redirect(`${kembali}?error=${encodeURIComponent("Hanya Kepala Gudang / Manajer yang bisa menyetujui")}`);
  }

  // qty disetujui per baris — hanya baris milik permintaan ini yang boleh disentuh.
  const { data: baris } = await supabase
    .from("stock_request_items").select("id, qty_diminta").eq("request_id", id);
  for (const b of (baris ?? []) as { id: string; qty_diminta: number }[]) {
    const raw = formData.get(`qty_${b.id}`);
    const qty = raw == null ? Number(b.qty_diminta) : Math.max(0, Number(raw) || 0);
    await supabase.from("stock_request_items").update({ qty_disetujui: qty }).eq("id", b.id);
  }

  await supabase
    .from("stock_requests")
    .update({ status: "Disetujui", approved_by: user?.id ?? null })
    .eq("id", id);

  revalidatePath("/pos/permintaan");
  redirect(`${kembali}?success=setuju`);
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
