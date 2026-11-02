"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";
import { bersihkanCacheSebentar } from "@/lib/cache-memori";
import { samakanHargaVaksinasi } from "@/lib/harga-vaksinasi";

const BACK = "/pos/harga";

// Nama field: `h|<item_id>|<satuan>`. Satuan ikut di nama karena satu barang bisa
// punya beberapa satuan (pcs/box/dus) dan tiap satuan harganya berdiri sendiri.
// Pasangannya `o|<item_id>|<satuan>` = nilai saat halaman dibuka. Hanya baris yang benar-benar
// diubah yang ditulis: menyimpan tab lama tidak boleh mengembalikan harga barang lain ke
// angka lama (1 Nov 15.58: 15 harga yang baru diganti kembali ke harga impor sekaligus).
function bacaHarga(formData: FormData) {
  const asal = new Map<string, string>();
  for (const [name, raw] of formData.entries()) {
    if (name.startsWith("o|")) asal.set(name.slice(2), String(raw ?? "").trim());
  }
  const sama = (key: string, harga: number | null) => {
    if (!asal.has(key)) return false; // form lama tanpa nilai asal: perlakukan sebagai diubah
    const awal = asal.get(key)!;
    return harga === null ? awal === "" : awal !== "" && Number(awal) === harga;
  };
  const rows: { itemId: string; unit: string; harga: number | null }[] = [];
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("h|")) continue;
    // Nama satuan boleh mengandung "|" — sisanya digabung lagi, jangan dipotong.
    const [, itemId, ...sisa] = name.split("|");
    const unit = sisa.join("|");
    if (!itemId || !unit) continue;
    const teks = String(raw ?? "").trim();
    let harga: number | null = null; // kosong = ikut harga pusat
    if (teks !== "") {
      const n = Number(teks);
      if (!Number.isFinite(n) || n < 0) continue;
      harga = n;
    }
    if (sama(name.slice(2), harga)) continue;
    rows.push({ itemId, unit, harga });
  }
  return rows;
}

export async function simpanHargaJual(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "harga jual");
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const q = String(formData.get("q") ?? "").trim();

  const kembali = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(branchId ? { cabang: branchId } : {}), ...(q ? { q } : {}), ...extra });
    redirect(`${BACK}?${p}`);
  };

  const rows = bacaHarga(formData);
  if (rows.length === 0) kembali({ success: "1" });

  // ── Semua Cabang: yang diubah adalah harga pusat, bukan override.
  if (!branchId) {
    const ids = [...new Set(rows.map((r) => r.itemId))];
    const { data: items } = await supabase.from("items").select("id, unit, code, item_type").in("id", ids);
    const master = new Map(
      ((items ?? []) as { id: string; unit: string; code: string | null; item_type: string | null }[]).map((i) => [i.id, i]),
    );
    const vials: { code: string | null; harga: number }[] = [];
    for (const r of rows) {
      if (r.harga === null) continue; // harga pusat tidak boleh dikosongkan
      const item = master.get(r.itemId);
      const dasar = item?.unit === r.unit;
      const { error } = dasar
        ? await supabase.from("items").update({ sell_price: r.harga }).eq("id", r.itemId)
        : await supabase.from("item_units").update({ sell_price: r.harga }).eq("item_id", r.itemId).eq("unit", r.unit);
      if (error) { bersihkanCacheSebentar(); kembali({ error: pesanSimpanGagal(error.message) }); }
      if (dasar && item && item.item_type !== "Jasa" && item.item_type !== "Grup") vials.push({ code: item.code, harga: r.harga });
    }
    // Vial vaksin: jasa "Vaksinasi …" yang ditagih klinik ikut harga vial yang baru.
    const vaksinError = await samakanHargaVaksinasi(supabase, vials);
    if (vaksinError) { bersihkanCacheSebentar(); kembali({ error: pesanSimpanGagal(vaksinError) }); }
    // Harga pusat ada di katalog kasir/klinik yang disimpan sementara di memori instance ini.
    bersihkanCacheSebentar();
    kembali({ success: "1" });
  }

  // ── Cabang tertentu: isi = simpan override, kosong = hapus override.
  const isi = rows.filter((r) => r.harga !== null);
  const kosong = rows.filter((r) => r.harga === null);

  if (isi.length > 0) {
    const { error } = await supabase.from("item_branch_prices").upsert(
      isi.map((r) => ({
        item_id: r.itemId, branch_id: branchId, unit: r.unit,
        sell_price: r.harga, updated_at: new Date().toISOString(),
      })),
      { onConflict: "item_id,branch_id,unit" },
    );
    if (error) kembali({ error: pesanSimpanGagal(error.message) });
  }
  for (const r of kosong) {
    await supabase.from("item_branch_prices").delete()
      .eq("item_id", r.itemId).eq("branch_id", branchId).eq("unit", r.unit);
  }

  kembali({ success: "1" });
}
