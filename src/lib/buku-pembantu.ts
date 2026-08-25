// Buku besar pembantu piutang & hutang — logika murni, dites di
// __tests__/buku-pembantu.test.ts.
//
// Bedanya dengan layar Piutang/Hutang yang sudah ada: layar itu hanya menampilkan
// sisa yang BELUM lunas hari ini. Buku pembantu menampilkan pergerakannya —
// saldo awal, tiap faktur dan tiap pembayaran di rentang tanggal, lalu saldo akhir.
// Itulah yang dicari kalau ada selisih dan harus ditelusuri per pelanggan/pemasok.
//
// Sumbernya dokumen (faktur & pembayaran), bukan jurnal: baris jurnal tidak menyimpan
// pelanggan/pemasoknya. Karena itu halaman pemakainya wajib membandingkan saldo akhir
// di sini dengan saldo akun buku besarnya — selisih berarti ada yang tidak terjurnal.

export type JenisMutasi = "Faktur" | "Pembayaran" | "Uang muka" | "Retur";

export type Mutasi = {
  tanggal: string;   // YYYY-MM-DD
  pihakId: string;
  pihak: string;
  nomor: string;
  jenis: JenisMutasi;
  keterangan: string;
  /** Menambah piutang/hutang (faktur terbit). */
  naik: number;
  /** Mengurangi piutang/hutang (bayar, retur, uang muka dipakai). */
  turun: number;
  href?: string;
};

export type BarisMutasi = Mutasi & { saldo: number };

export type BarisPihak = {
  pihakId: string;
  pihak: string;
  saldoAwal: number;
  naik: number;
  turun: number;
  saldoAkhir: number;
  mutasi: BarisMutasi[];
};

// Faktur didahulukan dari pembayaran di tanggal yang sama: bayar duluan lalu
// fakturnya menyusul membuat saldo berjalan sempat minus tanpa sebab.
const URUT: Record<JenisMutasi, number> = { Faktur: 0, "Uang muka": 1, Retur: 2, Pembayaran: 3 };

function urutkan(a: Mutasi, b: Mutasi): number {
  return a.tanggal.localeCompare(b.tanggal)
    || URUT[a.jenis] - URUT[b.jenis]
    || a.nomor.localeCompare(b.nomor);
}

export function bukuPembantu(mutasi: Mutasi[], dari: string, sampai: string): BarisPihak[] {
  const per = new Map<string, Mutasi[]>();
  for (const m of mutasi) {
    const arr = per.get(m.pihakId);
    if (arr) arr.push(m); else per.set(m.pihakId, [m]);
  }

  const hasil: BarisPihak[] = [];
  for (const [pihakId, isi] of per) {
    isi.sort(urutkan);

    let saldoAwal = 0;
    const dalam: Mutasi[] = [];
    for (const m of isi) {
      if (m.tanggal < dari) saldoAwal += m.naik - m.turun;
      else if (m.tanggal <= sampai) dalam.push(m);
      // di atas `sampai` sengaja dibuang: laporan ini "posisi per tanggal".
    }

    let saldo = saldoAwal;
    const baris: BarisMutasi[] = dalam.map((m) => {
      saldo += m.naik - m.turun;
      return { ...m, saldo };
    });

    const naik = dalam.reduce((a, m) => a + m.naik, 0);
    const turun = dalam.reduce((a, m) => a + m.turun, 0);

    // Pihak yang saldo awalnya nol dan tidak bergerak sama sekali tidak ditampilkan —
    // daftar pelanggan/pemasok bisa ratusan dan yang dicari cuma yang bergerak.
    if (saldoAwal === 0 && baris.length === 0) continue;

    hasil.push({
      pihakId,
      pihak: isi[0].pihak,
      saldoAwal, naik, turun,
      saldoAkhir: saldoAwal + naik - turun,
      mutasi: baris,
    });
  }

  // Saldo akhir terbesar di atas; yang sudah nol turun ke bawah tapi tetap terlihat.
  return hasil.sort((a, b) => b.saldoAkhir - a.saldoAkhir || a.pihak.localeCompare(b.pihak));
}

export type TotalPembantu = { saldoAwal: number; naik: number; turun: number; saldoAkhir: number };

export function totalPembantu(baris: BarisPihak[]): TotalPembantu {
  return baris.reduce(
    (a, b) => ({
      saldoAwal: a.saldoAwal + b.saldoAwal,
      naik: a.naik + b.naik,
      turun: a.turun + b.turun,
      saldoAkhir: a.saldoAkhir + b.saldoAkhir,
    }),
    { saldoAwal: 0, naik: 0, turun: 0, saldoAkhir: 0 },
  );
}

/**
 * Selisih saldo akhir buku pembantu terhadap saldo akun buku besarnya.
 * Dibulatkan ke rupiah penuh supaya sisa pecahan sen tidak terbaca sebagai selisih.
 */
export function selisihBukuBesar(saldoPembantu: number, saldoBukuBesar: number): number {
  return Math.round(saldoPembantu) - Math.round(saldoBukuBesar);
}
