import { vaccinationOf } from "@/lib/procedure-bmhp";

type Item = { id: string; code?: string | null; name: string; unit: string; sell_price: number };

/** Vial vaksin di daftar obat dibuka sebagai jasa vaksinasinya; keterangan ini menyebut jasa
 * dan harga yang akan masuk keranjang supaya tidak tertukar dengan harga vial. */
export function VaksinasiDariVial({ item, services }: { item: Item; services: Item[] }) {
  const service = vaccinationOf(item, services);
  if (!service) return null;
  return <small style={{ display: "block", fontSize: 9, fontWeight: 400, color: "var(--tm)" }}>
    Masuk sebagai {service.name} · Rp {Math.round(service.sell_price).toLocaleString("id-ID")}
  </small>;
}
