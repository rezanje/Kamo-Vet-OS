import { keteranganJejak, type JejakMundur } from "@/lib/expense-jejak";

/** Penanda kecil "Mundur" pada baris pengeluaran yang dicatat dengan tanggal mundur; alasan dan waktu input ada di tooltip dan di detail. */
export function LencanaMundur({ jejak }: { jejak: JejakMundur | null | undefined }) {
  if (!jejak) return null;
  return <span className="bge o" style={{ marginLeft: 5 }} title={keteranganJejak(jejak)} data-testid="lencana-mundur">Mundur</span>;
}
