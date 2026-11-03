// Nama petugas di kepala dokumen cetak klinik (struk, struk gabungan, invoice A4).
//
// Permintaan Babibu, 3 November 2026: untuk grooming, invoice perlu menyebut
// (1) dokter pemeriksa, (2) groomer, (3) kasir. Sebelumnya hanya ada satu baris
// "Dokter PJ" (permintaan Andri, 29 Okt — lihat `dokter-pj.ts`). Pada kunjungan
// Grooming, orang yang dipilih saat registrasi adalah GROOMER, sehingga namanya
// tercetak keliru sebagai "Dokter PJ".
//
// Kueri rincian `invoice_items` di tiap dokumen ikut membaca `service_performers`,
// `item:items!invoice_items_item_id_fkey(tindakan_kategori)`, dan
// `resep:prescription_items!invoice_items_prescription_item_id_fkey(kategori)`.
//
// Sumber nama: cuplikan pelaksana per baris tagihan (`invoice_items.service_performers`),
// yang menyimpan nama dokter & non-dokter saat transaksi. Basis data mewajibkan baris
// layanan Grooming membawa groomer (dan dokter di cabang klinik), jadi nama ini ada.
// Nama tetap nama yang tercatat saat transaksi, bukan dibaca ulang dari data hari ini.
//
// Aturan:
// - Kunjungan Grooming: "Dokter Pemeriksa" = dokter yang tercatat di baris tagihan;
//   "Groomer" = groomer di baris layanan Grooming, atau — untuk data lama tanpa cuplikan —
//   orang yang dipilih saat registrasi (yang memang groomer).
// - Kunjungan lain: tetap "Dokter PJ"; baris "Groomer" ditambahkan hanya bila tagihannya
//   memuat layanan Grooming.
// - Pelaksana per baris tetap TIDAK dicetak di samping tiap item (keputusan Andri tetap).

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Cuplikan = { doctor_name?: string | null; staff_name?: string | null } | null;

export type BarisPetugas = {
  service_performers?: Cuplikan;
  item?: Rel<{ tindakan_kategori: string | null }>;
  resep?: Rel<{ kategori: string | null }>;
};

export type Petugas = { label: string; nama: string };

export const isKunjunganGrooming = (poli: string | null | undefined) => poli?.trim().toLowerCase() === "grooming";

const barisGrooming = (b: BarisPetugas) =>
  one(b.item ?? null)?.tindakan_kategori === "Grooming" || one(b.resep ?? null)?.kategori === "Grooming";

const unik = (nama: (string | null | undefined)[]) =>
  [...new Set(nama.map((n) => (n ?? "").trim()).filter(Boolean))];

/** Baris petugas untuk satu kunjungan, urut sesuai permintaan: dokter, groomer (kasir dicetak terpisah). */
export function petugasCetak(
  poli: string | null | undefined,
  dokterPJ: string | null,
  baris: readonly BarisPetugas[],
): Petugas[] {
  const groomer = unik(baris.filter(barisGrooming).map((b) => b.service_performers?.staff_name));
  if (!isKunjunganGrooming(poli)) {
    return [
      ...(dokterPJ ? [{ label: "Dokter PJ", nama: dokterPJ }] : []),
      ...(groomer.length ? [{ label: "Groomer", nama: groomer.join(", ") }] : []),
    ];
  }
  const dokter = unik(baris.map((b) => b.service_performers?.doctor_name));
  const groomerAkhir = groomer.length ? groomer : unik([dokterPJ]);
  return [
    ...(dokter.length ? [{ label: "Dokter Pemeriksa", nama: dokter.join(", ") }] : []),
    ...(groomerAkhir.length ? [{ label: "Groomer", nama: groomerAkhir.join(", ") }] : []),
  ];
}
