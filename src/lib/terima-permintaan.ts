// Penerimaan barang atas Permintaan Barang — SATU jalur untuk petshop & klinik.
//
// Sebelum ini ada dua salinan yang berbeda perilakunya, dan yang klinik salah:
// ia memakai stockIn (menambah stok cabang) tanpa stockOut di gudang pengirim,
// jadi setiap penerimaan klinik MENGGANDAKAN barang — DC tetap penuh, klinik
// bertambah. Yang petshop sudah benar (transferStock). Bedanya tidak terlihat
// di layar mana pun, cuma muncul sebagai stok yang terus melar.
//
// Aturan yang dipegang di sini:
// - Stok berpindah, bukan tercipta: gudang pengirim (stock_requests.to_warehouse_id)
//   berkurang, gudang cabang penerima bertambah.
// - Hanya barang kondisi "baik" yang jadi stok; rusak/kurang tetap tercatat penuh
//   di dokumen TRM sebagai dasar klaim ke DC.
// - Qty selalu dikonversi ke satuan dasar memakai faktor yang TERSIMPAN di baris
//   permintaan, bukan kiriman klien.
// - Stok dipindah DULU; kalau gagal, dokumen penerimaan tidak dibuat sama sekali.

import { transferStock } from "./inventory";
import { nomorBerikutnya } from "./no-dokumen";
import { toBaseQty } from "./satuan";
import { receiptSummary } from "./stock-recon";
import { hariIniWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type BarisTerima = {
  id: string;
  item_id: string | null;
  nama?: string;
  qty_diminta?: number;
  qty_diterima: number;
  kondisi: string;
  notes?: string;
};

export type HasilTerima =
  | { ok: true; receiptNumber: string; selisih: number }
  | { ok: false; error: string };

const baik = (kondisi: string | null | undefined) => (kondisi || "baik").toLowerCase() === "baik";

/** Nomor dokumen penerimaan; formatnya dibaca dari master penomoran (bawaan TRM-YYMMDD-NNN). */
export async function nomorPenerimaan(supabase: AnyClient): Promise<string> {
  const { nomor } = await nomorBerikutnya(supabase, "TRM", hariIniWIB(), {
    table: "stock_receipts", column: "receipt_number",
  });
  return nomor;
}

export async function prosesTerimaPermintaan(
  supabase: AnyClient,
  o: { requestId: string; branchId: string; receivedBy: string | null; rows: BarisTerima[] },
): Promise<HasilTerima> {
  const { requestId, branchId, receivedBy, rows } = o;
  if (!requestId) return { ok: false, error: "Permintaan tidak dipilih." };
  if (rows.length === 0) return { ok: false, error: "Tidak ada barang yang diterima." };

  // Gudang pengirim wajib ada. Dulu blok stok dilewati diam-diam kalau kosong →
  // dokumen bilang "berhasil" tapi stok tidak pernah berpindah.
  const { data: req } = await supabase
    .from("stock_requests").select("to_warehouse_id, status").eq("id", requestId).maybeSingle();
  if (!req?.to_warehouse_id) {
    return { ok: false, error: "Permintaan tidak ditemukan atau gudang pengirimnya kosong." };
  }
  if (req.status === "Selesai") {
    return { ok: false, error: "Permintaan ini sudah pernah diterima." };
  }

  const { data: wh } = await supabase
    .from("warehouses").select("id")
    .eq("branch_id", branchId).eq("is_active", true)
    .order("code").limit(1).maybeSingle();
  if (!wh) {
    return { ok: false, error: "Cabang ini belum punya gudang aktif — stok tidak bisa masuk. Hubungi admin." };
  }

  // Satuan & faktor diambil dari baris permintaan yang tersimpan, bukan dari klien:
  // faktor palsu bikin stok bertambah lebih banyak dari yang benar dikirim.
  const { data: baris } = await supabase
    .from("stock_request_items").select("id, satuan, faktor").eq("request_id", requestId);
  const satuanOf = new Map(
    ((baris ?? []) as { id: string; satuan: string | null; faktor: number }[]).map((b) => [
      b.id, { satuan: b.satuan ?? null, faktor: Number(b.faktor) || 1 },
    ]),
  );

  // ponytail: gagal di tengah loop bisa menyisakan sebagian item terpindah — upgrade
  // ke RPC Postgres satu transaksi kalau ini pernah kejadian di produksi.
  try {
    for (const row of rows) {
      if (!row.item_id || !baik(row.kondisi)) continue;
      const qty = Number(row.qty_diterima) || 0;
      if (qty <= 0) continue;
      await transferStock(supabase, {
        fromWarehouseId: req.to_warehouse_id as string,
        toWarehouseId: wh.id as string,
        itemId: row.item_id,
        qty: toBaseQty(qty, satuanOf.get(row.id)?.faktor ?? 1),
        source: "terima-permintaan",
        ref: requestId,
      });
    }
  } catch (e) {
    const pesan = e instanceof Error ? e.message : "gagal memperbarui stok";
    return { ok: false, error: `Penerimaan dibatalkan — stok gagal diperbarui (${pesan})` };
  }

  const receiptNumber = await nomorPenerimaan(supabase);
  const { data: receipt, error: recErr } = await supabase
    .from("stock_receipts")
    .insert({ receipt_number: receiptNumber, stock_request_id: requestId, received_by: receivedBy })
    .select("id").single();
  if (recErr || !receipt) {
    return { ok: false, error: recErr?.message ?? "Gagal membuat dokumen penerimaan." };
  }

  await supabase.from("stock_receipt_items").insert(
    rows.map((r) => ({
      stock_receipt_id: receipt.id,
      item_id: r.item_id,
      nama: String(r.nama ?? "").slice(0, 160) || "—",
      qty_ordered: Number(r.qty_diminta) || 0,
      qty_received: Number(r.qty_diterima) || 0,
      satuan: satuanOf.get(r.id)?.satuan ?? null,
      faktor: satuanOf.get(r.id)?.faktor ?? 1,
      condition: (r.kondisi || "baik").toLowerCase(),
      notes: (r.notes ?? "").trim() || null,
    })),
  );

  for (const row of rows) {
    await supabase
      .from("stock_request_items")
      .update({ qty_diterima: Number(row.qty_diterima) || 0, kondisi: row.kondisi || null })
      .eq("id", row.id);
  }
  await supabase.from("stock_requests").update({ status: "Selesai" }).eq("id", requestId);

  // Pindah gudang sendiri tidak dijurnal: nilainya sudah tercatat sebagai Persediaan
  // saat barang masuk di gudang asal, di sini cuma pindah lokasi.
  const summary = receiptSummary(
    rows.map((r) => ({ qty_ordered: Number(r.qty_diminta) || 0, qty_received: Number(r.qty_diterima) || 0 })),
  );
  return { ok: true, receiptNumber, selisih: summary.selisih };
}
