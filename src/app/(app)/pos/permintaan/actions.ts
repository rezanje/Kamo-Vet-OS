"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canApprove, canTransitionRequest } from "@/lib/stock-recon";
import { loadMasterPermintaan, parseBarisInput, siapkanBaris } from "@/lib/permintaan";
import { prosesTerimaPermintaan, type BarisTerima } from "@/lib/terima-permintaan";
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

/**
 * Terima barang dari backoffice, atas nama cabang peminta.
 *
 * Layar penerimaan yang lama cuma ada di dunia kasir (`/kasir/persediaan`) dan
 * klinik — dua-duanya butuh shift terbuka, jadi admin/gudang pusat tidak punya
 * jalan sama sekali untuk menutup permintaan. Itu sebabnya orang memakai tombol
 * "Selesai" yang tidak memindahkan stok. Cabang penerimanya diambil dari
 * permintaan (from_branch_id), bukan dari shift.
 */
export async function terimaDariBackoffice(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const kembali = `/pos/permintaan/${id}`;

  const { data: req } = await supabase
    .from("stock_requests")
    .select("status, from_branch_id, stock_request_items(id, nama, qty_diminta, qty_disetujui)")
    .eq("id", id).maybeSingle();
  if (!req) redirect(`/pos/permintaan?error=${encodeURIComponent("Permintaan tidak ditemukan")}`);
  if (req!.status !== "Dikirim") {
    redirect(`${kembali}?error=${encodeURIComponent(`Hanya permintaan berstatus Dikirim yang bisa diterima (sekarang ${req!.status}).`)}`);
  }
  if (!req!.from_branch_id) {
    redirect(`${kembali}?error=${encodeURIComponent("Permintaan ini tidak punya cabang peminta — stok tidak tahu harus masuk ke mana.")}`);
  }

  // Qty & kondisi dibaca per baris milik permintaan ini saja.
  type Baris = { id: string; nama: string; qty_diminta: number; qty_disetujui: number | null };
  const rows: BarisTerima[] = ((req!.stock_request_items ?? []) as Baris[]).map((b) => {
    const bawaan = Number(b.qty_disetujui ?? b.qty_diminta) || 0;
    const raw = formData.get(`qty_${b.id}`);
    return {
      id: b.id,
      item_id: null, // diisi di bawah dari master baris
      nama: b.nama,
      qty_diminta: Number(b.qty_diminta) || 0,
      qty_diterima: raw == null ? bawaan : Math.max(0, Number(raw) || 0),
      kondisi: String(formData.get(`kondisi_${b.id}`) ?? "baik"),
    };
  });

  // item_id tidak ikut di select atas (kolomnya ada di baris) — ambil terpisah
  // supaya tidak ada baris yang dipindahkan tanpa barang yang jelas.
  const { data: itemIds } = await supabase
    .from("stock_request_items").select("id, item_id").eq("request_id", id);
  const petaItem = new Map(((itemIds ?? []) as { id: string; item_id: string | null }[]).map((r) => [r.id, r.item_id]));
  for (const r of rows) r.item_id = petaItem.get(r.id) ?? null;

  const { data: { user } } = await supabase.auth.getUser();
  const hasil = await prosesTerimaPermintaan(supabase, {
    requestId: id,
    branchId: req!.from_branch_id as string,
    receivedBy: user?.id ?? null,
    rows,
  });
  if (!hasil.ok) redirect(`${kembali}?error=${encodeURIComponent(hasil.error)}`);

  revalidatePath("/pos/permintaan");
  redirect(`${kembali}?success=terima&trm=${hasil.receiptNumber}`);
}

export async function updateRequestStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));

  const { data: req } = await supabase.from("stock_requests").select("status").eq("id", id).single();
  if (!req) redirect(`/pos/permintaan?error=${encodeURIComponent("Permintaan tidak ditemukan")}`);

  // "Selesai" hanya boleh lahir dari dokumen penerimaan (lib/terima-permintaan),
  // karena di situlah stok benar-benar berpindah dan qty yang sampai dicatat.
  // Sebelum penjagaan ini ada, tombol "Terima / Selesai" di backoffice cuma
  // mengganti label: permintaan tampak beres padahal stok cabang tidak bertambah
  // sama sekali (dilaporkan tim 2026-08-11).
  if (status === "Selesai") {
    redirect(`/pos/permintaan?error=${encodeURIComponent(
      "Permintaan ditutup lewat penerimaan barang di cabang penerima, bukan dari sini — supaya stoknya ikut berpindah.",
    )}`);
  }

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
