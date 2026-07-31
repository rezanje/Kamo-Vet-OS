"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/harga";

// Nama field: `h|<item_id>|<satuan>`. Satuan ikut di nama karena satu barang bisa
// punya beberapa satuan (pcs/box/dus) dan tiap satuan harganya berdiri sendiri.
function bacaHarga(formData: FormData) {
  const rows: { itemId: string; unit: string; harga: number | null }[] = [];
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("h|")) continue;
    // Nama satuan boleh mengandung "|" — sisanya digabung lagi, jangan dipotong.
    const [, itemId, ...sisa] = name.split("|");
    const unit = sisa.join("|");
    if (!itemId || !unit) continue;
    const teks = String(raw ?? "").trim();
    if (teks === "") {
      rows.push({ itemId, unit, harga: null }); // kosong = ikut harga pusat
      continue;
    }
    const n = Number(teks);
    if (!Number.isFinite(n) || n < 0) continue;
    rows.push({ itemId, unit, harga: n });
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
    const { data: items } = await supabase.from("items").select("id, unit").in("id", ids);
    const satuanDasar = new Map(
      ((items ?? []) as { id: string; unit: string }[]).map((i) => [i.id, i.unit]),
    );
    for (const r of rows) {
      if (r.harga === null) continue; // harga pusat tidak boleh dikosongkan
      const { error } = satuanDasar.get(r.itemId) === r.unit
        ? await supabase.from("items").update({ sell_price: r.harga }).eq("id", r.itemId)
        : await supabase.from("item_units").update({ sell_price: r.harga }).eq("item_id", r.itemId).eq("unit", r.unit);
      if (error) kembali({ error: pesanSimpanGagal(error.message) });
    }
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
