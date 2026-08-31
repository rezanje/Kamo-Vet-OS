// Rekap transaksi lintas kanal (POS, Online, Klinik) — logika murni,
// dites di __tests__/laporan-transaksi.test.ts.
//
// Satu sumber angka untuk empat laporan dasar yang diminta Kamo Group:
// jumlah transaksi per cabang, rata-rata transaksi per pelanggan,
// rata-rata item per struk, dan jumlah pelanggan per hari.

export type Kanal = "POS" | "Online" | "Klinik";

export type Trx = {
  tanggal: string;           // YYYY-MM-DD menurut WIB
  cabang: string;
  customerId: string | null; // null = pembeli umum yang identitasnya tidak dicatat
  omzet: number;             // sudah dikurangi retur
  item: number;              // jumlah BARIS item pada dokumen
  kanal: Kanal;
};

export type Rekap = {
  trx: number;
  omzet: number;
  item: number;
  /** Pelanggan berkartu yang unik — dasar rata-rata kunjungan per pelanggan. */
  pelangganTerdaftar: number;
  /** Struk tanpa identitas pembeli; tiap struk dianggap satu orang. */
  trxTanpaAkun: number;
  /** Perkiraan orang yang dilayani = pelanggan berkartu + tiap struk umum. */
  pelangganDilayani: number;
  rataPerTrx: number;
  rataItemPerTrx: number;
  /**
   * Rata-rata jumlah transaksi per pelanggan. Sengaja HANYA dari pelanggan
   * berkartu: kalau struk umum ikut dihitung, angkanya selalu mendekati 1
   * karena tiap struk umum dianggap orang baru dan rasionya jadi tidak berarti.
   */
  rataTrxPerPelanggan: number;
};

/** Status yang tidak boleh masuk angka penjualan lintas laporan. */
export const STATUS_TRANSAKSI_BATAL = new Set(["void", "batal", "cancelled", "canceled", "dibatalkan"]);

export function transaksiValid(status: string | null | undefined): boolean {
  return !STATUS_TRANSAKSI_BATAL.has((status ?? "").trim().toLowerCase());
}

export function batasTanggalWIB(dari: string, sampai: string) {
  return {
    mulai: `${dari}T00:00:00+07:00`,
    akhir: `${sampai}T23:59:59.999+07:00`,
  };
}

const bagi = (atas: number, bawah: number) => (bawah ? atas / bawah : 0);

export function rekap(list: Trx[]): Rekap {
  const orang = new Set<string>();
  let trx = 0, omzet = 0, item = 0, tanpaAkun = 0, trxTerdaftar = 0;

  for (const t of list) {
    trx++;
    omzet += Number(t.omzet) || 0;
    item += Number(t.item) || 0;
    if (t.customerId) {
      orang.add(t.customerId);
      trxTerdaftar++;
    } else {
      tanpaAkun++;
    }
  }

  return {
    trx, omzet, item,
    pelangganTerdaftar: orang.size,
    trxTanpaAkun: tanpaAkun,
    pelangganDilayani: orang.size + tanpaAkun,
    rataPerTrx: bagi(omzet, trx),
    rataItemPerTrx: bagi(item, trx),
    rataTrxPerPelanggan: bagi(trxTerdaftar, orang.size),
  };
}

function kelompok<K extends string>(list: Trx[], kunci: (t: Trx) => K) {
  const map = new Map<K, Trx[]>();
  for (const t of list) {
    const k = kunci(t);
    const arr = map.get(k);
    if (arr) arr.push(t); else map.set(k, [t]);
  }
  return map;
}

export type BarisCabang = Rekap & { cabang: string };

export function perCabang(list: Trx[]): BarisCabang[] {
  return [...kelompok(list, (t) => t.cabang || "—")]
    .map(([cabang, isi]) => ({ cabang, ...rekap(isi) }))
    .sort((a, b) => b.omzet - a.omzet);
}

export type BarisHari = Rekap & { tanggal: string };

/** Hari terbaru di atas — sama seperti daftar transaksi lainnya. */
export function perHari(list: Trx[]): BarisHari[] {
  return [...kelompok(list, (t) => t.tanggal)]
    .map(([tanggal, isi]) => ({ tanggal, ...rekap(isi) }))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

/** Pecahan per kanal untuk satu kumpulan transaksi — kolom POS / Online / Klinik. */
export function perKanal(list: Trx[]): Record<Kanal, number> {
  const h: Record<Kanal, number> = { POS: 0, Online: 0, Klinik: 0 };
  for (const t of list) h[t.kanal]++;
  return h;
}
