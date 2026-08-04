"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { receiptSummary } from "@/lib/stock-recon";
import { transferStock } from "@/lib/inventory";
import { loadMasterPermintaan, parseBarisInput, siapkanBaris } from "@/lib/permintaan";
import { toBaseQty } from "@/lib/satuan";
import { formatNomor, urutanBerikutnya } from "@/lib/no-dokumen";

// Buat permintaan barang dari dunia kasir — cabang asal otomatis dari shift terbuka.
export async function buatPermintaanKasir(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const priority = String(formData.get("priority") ?? "normal") === "tinggi" ? "tinggi" : "normal";

  if (!to_warehouse_id) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gudang tujuan wajib diisi."));
  }

  // Satuan & jenis barang ditentukan ulang dari master — kiriman klien tidak dipercaya.
  const input = parseBarisInput(formData.get("items"));
  const master = await loadMasterPermintaan(supabase, input.map((b) => String(b.item_id ?? "")));
  const { rows: baris, error: barisErr } = siapkanBaris(input, master);
  if (barisErr) redirect("/kasir/persediaan/baru?error=" + encodeURIComponent(barisErr));

  // no_request = PRM-YYYYMMDD-NNNN (urutan hari ini +1, padded 4). Today 2026-07-01.
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
    .insert({ no_request, from_branch_id: shift.branch_id, to_warehouse_id, catatan, priority, requested_by: user.id })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  // §5: catatan per item ("stok menipis", dst) ikut tersimpan dari siapkanBaris.
  await supabase.from("stock_request_items").insert(
    baris.map((b) => ({ ...b, request_id: (req as { id: string }).id })),
  );

  revalidatePath("/kasir/persediaan");
  redirect("/kasir/persediaan?tab=permintaan&success=1");
}

type TerimaRow = { id: string; item_id: string | null; nama?: string; qty_diminta?: number; qty_diterima: number; kondisi: string; notes?: string };

// Penerimaan barang (Addendum §5): buat dokumen penerimaan (TRM) dgn rekonsiliasi
// dipesan vs diterima, tandai request Selesai, stok bertambah sesuai QTY DITERIMA.
export async function terimaBarang(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) redirect("/kasir/persediaan?tab=penerimaan");

  let rows: TerimaRow[] = [];
  try {
    rows = JSON.parse(String(formData.get("items") ?? "[]")) as TerimaRow[];
  } catch {
    rows = [];
  }

  // Gudang asal (DC pengirim) & gudang tujuan (retail cabang shift) wajib ketemu.
  // Dulu blok stok diam-diam dilewati kalau gudang tujuan tidak ada → dokumen bilang
  // "berhasil" tapi stok tidak pernah bertambah.
  const { data: req } = await supabase
    .from("stock_requests").select("to_warehouse_id").eq("id", requestId).maybeSingle();
  if (!req?.to_warehouse_id) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent("Permintaan tidak ditemukan atau gudang pengirimnya kosong.")}`);
  }

  // Satuan & faktor diambil dari baris permintaan yang tersimpan, bukan dari klien:
  // stok selalu bertambah dalam satuan dasar (qty × faktor).
  const { data: baris } = await supabase
    .from("stock_request_items").select("id, satuan, faktor").eq("request_id", requestId);
  const satuanOf = new Map(
    ((baris ?? []) as { id: string; satuan: string | null; faktor: number }[]).map((b) => [
      b.id, { satuan: b.satuan ?? "", faktor: Number(b.faktor) || 1 },
    ]),
  );

  const { data: wh } = await supabase
    .from("warehouses").select("id")
    .eq("branch_id", shift.branch_id).eq("is_active", true)
    .order("code").limit(1).maybeSingle();
  if (!wh) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent("Cabang ini belum punya gudang aktif — stok tidak bisa masuk. Hubungi admin.")}`);
  }

  // Pindah stok DULU (DC berkurang → cabang bertambah). Kalau gagal, dokumen
  // penerimaan tidak jadi dibuat — lebih baik gagal terang daripada "berhasil" palsu.
  // Hanya barang kondisi "baik" yang jadi stok jual; rusak/kurang tetap tercatat penuh
  // di dokumen TRM sebagai basis klaim ke DC.
  // ponytail: gagal di tengah loop bisa menyisakan sebagian item terpindah — upgrade
  // ke RPC Postgres satu transaksi kalau ini pernah kejadian di produksi.
  let stokErr: string | null = null;
  try {
    for (const row of rows) {
      if (!row.item_id) continue;
      if ((row.kondisi || "baik").toLowerCase() !== "baik") continue;
      const qty = Number(row.qty_diterima) || 0;
      if (qty <= 0) continue;
      await transferStock(supabase, {
        fromWarehouseId: req!.to_warehouse_id as string,
        toWarehouseId: wh!.id as string,
        itemId: row.item_id,
        qty: toBaseQty(qty, satuanOf.get(row.id)?.faktor ?? 1),
        source: "terima-permintaan",
        ref: requestId,
      });
    }
  } catch (e) {
    stokErr = e instanceof Error ? e.message : "gagal memperbarui stok";
  }
  if (stokErr) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent(`Penerimaan dibatalkan — stok gagal diperbarui (${stokErr})`)}`);
  }

  // dokumen penerimaan TRM-YYMMDD-NNN (§5).
  const now = new Date();
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefixTrm = `TRM-${ymd}-`;
  const receiptNumber = formatNomor(prefixTrm, await urutanBerikutnya(supabase, {
    table: "stock_receipts", column: "receipt_number", prefix: prefixTrm, pad: 3,
  }), 3);

  const { data: receipt, error: recErr } = await supabase
    .from("stock_receipts")
    .insert({ receipt_number: receiptNumber, stock_request_id: requestId, received_by: user.id })
    .select("id").single();
  if (recErr || !receipt) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent(recErr?.message ?? "Gagal buat dokumen penerimaan")}`);
  }

  await supabase.from("stock_receipt_items").insert(
    rows.map((r) => ({
      stock_receipt_id: receipt!.id,
      item_id: r.item_id,
      nama: String(r.nama ?? "").slice(0, 160) || "—",
      qty_ordered: Number(r.qty_diminta) || 0,
      qty_received: Number(r.qty_diterima) || 0,
      satuan: satuanOf.get(r.id)?.satuan || null,
      faktor: satuanOf.get(r.id)?.faktor ?? 1,
      condition: (r.kondisi || "baik").toLowerCase(),
      notes: (r.notes ?? "").trim() || null,
    })),
  );

  // legacy view di list lama tetap terisi.
  for (const row of rows) {
    await supabase
      .from("stock_request_items")
      .update({ qty_diterima: Number(row.qty_diterima) || 0, kondisi: row.kondisi || null })
      .eq("id", row.id);
  }

  await supabase.from("stock_requests").update({ status: "Selesai" }).eq("id", requestId);

  const summary = receiptSummary(rows.map((r) => ({ qty_ordered: Number(r.qty_diminta) || 0, qty_received: Number(r.qty_diterima) || 0 })));

  // ponytail: transfer internal antar gudang sendiri (DC → cabang) tidak dijurnal ulang —
  // nilainya sudah tercatat sbg Persediaan saat stok masuk di gudang asal; di sini cuma
  // pindah lokasi qty (sudah dikerjakan di atas sebelum dokumen dibuat).

  revalidatePath("/kasir/persediaan");
  redirect(`/kasir/persediaan?tab=penerimaan&success=terima&trm=${receiptNumber}&selisih=${summary.selisih}`);
}
