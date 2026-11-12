// Rekap transaksi lintas kanal (POS, Online, Klinik, Grosir) — logika murni,
// dites di __tests__/laporan-transaksi.test.ts.
//
// Satu sumber angka untuk empat laporan dasar yang diminta Kamo Group:
// jumlah transaksi per cabang, rata-rata transaksi per pelanggan,
// rata-rata item per struk, dan jumlah pelanggan per hari.

export type Kanal = "POS" | "Online" | "Klinik" | "Grosir";

/** Urutan tetap kanal di filter, kolom pecahan, dan kartu ringkasan tiap laporan. */
export const KANAL_SEMUA: Kanal[] = ["POS", "Online", "Klinik", "Grosir"];

/** Nama yang dibaca pengguna. Nilai di URL tetap kode kanalnya supaya tautan lama hidup. */
export const LABEL_KANAL: Record<Kanal, string> = {
  POS: "Kasir (POS)",
  Online: "Online",
  Klinik: "Klinik",
  Grosir: "Grosir (Faktur Penjualan)",
};

/** Pecahan kosong per kanal — dipakai sebagai titik awal penjumlahan. */
export const kanalKosong = (): Record<Kanal, number> => ({ POS: 0, Online: 0, Klinik: 0, Grosir: 0 });

export type Trx = {
  tanggal: string;           // YYYY-MM-DD menurut WIB
  cabang: string;
  cabangId?: string | null;
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
    akhir: `${sampai}T23:59:59.999999+07:00`,
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

export type BarisCabang = Rekap & { cabang: string; cabangId?: string };

export function perCabang(list: Trx[]): BarisCabang[] {
  return [...kelompok(list, (t) => t.cabangId ? `id:${t.cabangId}` : `name:${t.cabang || "—"}`)]
    .map(([, isi]) => ({ cabang: isi[0].cabang || "—", ...(isi[0].cabangId ? {cabangId:isi[0].cabangId} : {}), ...rekap(isi) }))
    .sort((a, b) => b.omzet - a.omzet);
}

export type BarisHari = Rekap & { tanggal: string };

/** Hari terbaru di atas — sama seperti daftar transaksi lainnya. */
export function perHari(list: Trx[]): BarisHari[] {
  return [...kelompok(list, (t) => t.tanggal)]
    .map(([tanggal, isi]) => ({ tanggal, ...rekap(isi) }))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

/** Pecahan per kanal untuk satu kumpulan transaksi — kolom POS / Online / Klinik / Grosir. */
export function perKanal(list: Trx[]): Record<Kanal, number> {
  const h = kanalKosong();
  for (const t of list) h[t.kanal]++;
  return h;
}

// ── A6 (meeting 12 Nov 2026): omzet harian per cabang — untuk Finance ─────────
//
// Matriks tanggal × cabang berisi OMZET SAJA (angka yang sama dengan kolom Omzet di
// atas: total dokumen setelah diskon, dikurangi retur) — tanpa biaya operasional.
// Setiap tanggal di rentang ditampilkan, termasuk hari tanpa transaksi (nilainya 0),
// supaya Finance bisa mencocokkan hari demi hari tanpa celah.

export type KolomCabangHarian = { kunci: string; cabangId: string | null; cabang: string };
export type BarisOmzetHarian = { tanggal: string; perCabang: Record<string, number>; total: number };
export type OmzetHarianPerCabang = {
  cabang: KolomCabangHarian[];
  baris: BarisOmzetHarian[];
  totalPerCabang: Record<string, number>;
  total: number;
};

const kunciCabang = (t: Pick<Trx, "cabangId" | "cabang">) => t.cabangId ? `id:${t.cabangId}` : `name:${t.cabang || "—"}`;

/** Tanggal dari..sampai (inklusif, YYYY-MM-DD). Dibatasi 400 hari supaya tabel tetap wajar. */
function rentangTanggal(dari: string, sampai: string): string[] {
  const hasil: string[] = [];
  const mulai = new Date(`${dari}T00:00:00Z`), akhir = new Date(`${sampai}T00:00:00Z`);
  if (Number.isNaN(mulai.getTime()) || Number.isNaN(akhir.getTime()) || mulai > akhir) return hasil;
  for (let d = mulai; d <= akhir && hasil.length < 400; d = new Date(d.getTime() + 86_400_000)) {
    hasil.push(d.toISOString().slice(0, 10));
  }
  return hasil;
}

export function omzetHarianPerCabang(list: Trx[], dari: string, sampai: string): OmzetHarianPerCabang {
  const kolom = perCabang(list).map((b) => ({ kunci: kunciCabang(b), cabangId: b.cabangId ?? null, cabang: b.cabang }));
  const peta = new Map<string, Map<string, number>>();
  for (const t of list) {
    const hari = peta.get(t.tanggal) ?? new Map<string, number>();
    const k = kunciCabang(t);
    hari.set(k, (hari.get(k) ?? 0) + t.omzet);
    peta.set(t.tanggal, hari);
  }
  // Semua tanggal di rentang + tanggal transaksi di luar rentang (mis. data aneh) agar total tetap utuh.
  const tanggal = [...new Set([...rentangTanggal(dari, sampai), ...peta.keys()])].sort();
  const totalPerCabang: Record<string, number> = Object.fromEntries(kolom.map((k) => [k.kunci, 0]));
  let total = 0;
  const baris = tanggal.map((tgl) => {
    const hari = peta.get(tgl);
    const perCabangHari: Record<string, number> = {};
    let jumlah = 0;
    for (const k of kolom) {
      const nilai = hari?.get(k.kunci) ?? 0;
      perCabangHari[k.kunci] = nilai;
      totalPerCabang[k.kunci] += nilai;
      jumlah += nilai;
    }
    total += jumlah;
    return { tanggal: tgl, perCabang: perCabangHari, total: jumlah };
  });
  return { cabang: kolom, baris, totalPerCabang, total };
}
