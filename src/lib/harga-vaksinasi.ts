import { kodeJasaVaksinasi } from "./procedure-bmhp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Klinik menagih vaksin lewat jasa "Vaksinasi …" (kode `JV-<kode vial>`), bukan lewat vial-nya.
 * Harga jasa itu selama ini selalu sama dengan harga vial, tapi tidak ikut berubah saat harga
 * vial diganti (1 Nov: 8 vaksin naik di vial, klinik tetap menagih harga lama). Fungsi ini
 * menyamakan harga jasa vaksinasi dengan harga dasar vial yang baru disimpan.
 */
export async function samakanHargaVaksinasi(
  supabase: AnyClient,
  vials: { code: string | null | undefined; harga: number }[],
): Promise<string | null> {
  for (const vial of vials) {
    const kode = kodeJasaVaksinasi(vial.code);
    if (!kode || !Number.isFinite(vial.harga) || vial.harga < 0) continue;
    const { error } = await supabase.from("items").update({ sell_price: vial.harga })
      .eq("code", kode).eq("item_type", "Jasa").neq("sell_price", vial.harga);
    if (error) return error.message as string;
  }
  return null;
}
