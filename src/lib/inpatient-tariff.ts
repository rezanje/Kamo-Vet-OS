// K14: tarif harian rawat inap vs pet hotel. Cermin dari clinic_change_inpatient_condition
// (migrasi 20261101141000): database memilih jasa aktif pertama per kategori (urut nama, id);
// periode pet hotel memakai jasa "Pet Hotel", dan bila tarifnya belum diisi (tidak ada jasa
// atau harga 0) memakai tarif Rawat Inap. Layar hanya memberi peringatan; hitungan tetap di database.
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export type TariffRow = { id: string; name: string; sell_price: number | string | null; tindakan_kategori: string | null };

export type StayTariffs = {
  sick: TariffRow | null;
  petHotel: TariffRow | null;
  /** Item yang berarti "biaya hari menginap" dan qty-nya dihitung sistem. */
  feeItemIds: string[];
};

const urut = (a: TariffRow, b: TariffRow) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function pickStayTariffs(rows: readonly TariffRow[]): StayTariffs {
  const first = (kategori: string) => [...rows].filter((r) => r.tindakan_kategori === kategori).sort(urut)[0] ?? null;
  const sick = first("Rawat Inap");
  const petHotel = first("Pet Hotel");
  return { sick, petHotel, feeItemIds: [sick?.id, petHotel?.id].filter((id): id is string => !!id) };
}

/** Peringatan untuk pet hotel; null = tarif pet hotel sudah diatur. */
export function petHotelTariffWarning(t: Pick<StayTariffs, "sick" | "petHotel">): string | null {
  if (t.petHotel && Number(t.petHotel.sell_price ?? 0) > 0) return null;
  if (!t.sick) return "Tarif Pet Hotel dan Rawat Inap belum ada di master jasa, jadi lama menginap belum bisa masuk tagihan sendiri. Isi harga jasa berkategori Pet Hotel (tarif per hari).";
  return "Tarif Pet Hotel belum diatur: saat pulang, lama menginap pet hotel ditagih memakai tarif Rawat Inap. Isi harga jasa berkategori Pet Hotel (tarif per hari) di master SKU.";
}

/** `failed` = tidak terbaca; pemanggil cukup tidak menampilkan peringatan apa pun. */
export async function readStayTariffs(db: Db): Promise<StayTariffs & { failed: boolean }> {
  const failed = { sick: null, petHotel: null, feeItemIds: [], failed: true };
  try {
    const { data, error } = await db.from("items")
      .select("id, name, sell_price, tindakan_kategori")
      .in("tindakan_kategori", ["Rawat Inap", "Pet Hotel"]).eq("is_active", true);
    if (error || !Array.isArray(data)) return failed;
    return { ...pickStayTariffs(data as TariffRow[]), failed: false };
  } catch {
    // Hanya untuk peringatan dan penguncian qty di layar; jangan jatuhkan halaman.
    return failed;
  }
}
