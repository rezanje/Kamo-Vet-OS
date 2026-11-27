/** Pencarian barang di halaman Stok per Gudang. */

// Karakter yang punya arti di sintaks filter PostgREST (koma, kurung, titik dua,
// kutip, backslash) dan wildcard (%, _, *). Dibuang dari kata pencarian.
const BUKAN_KATA = /[,()*%_:"'\\]/g;

/** Kata-kata pencarian (huruf kecil), dibersihkan persis seperti `polaCariStok`
 * supaya saringan di database dan di server selalu memakai kata yang sama. */
export function kataCariStok(q: string | null | undefined): string[] {
  return (q ?? "").replace(BUKAN_KATA, " ").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Pola ilike PostgREST yang aman untuk dipakai di dalam `.or(...)`.
 * Spasi berurutan jadi wildcard, sehingga "bolt 1kg" cocok dengan "BOLT IKAN 1KG".
 * Pola ini sengaja LONGGAR (cocok di tengah kata/kode): dipakai untuk mengambil
 * calon dari database, lalu `saringCariStok` yang memutuskan mana yang tampil. */
export function polaCariStok(q: string | null | undefined): string | null {
  const bersih = (q ?? "").replace(BUKAN_KATA, " ").trim().replace(/\s+/g, "*");
  return bersih ? `*${bersih}*` : null;
}

const HURUF_ANGKA = /[\p{L}\p{N}]/u;
const ANGKA = /\p{N}/u;

/** Posisi `i` adalah awal sebuah kata: awal teks, sesudah spasi/tanda baca, atau
 * peralihan huruf↔angka ("400gr" → "400" + "gr", "DRC8997…" → "DRC" + "8997…"). */
function awalKata(teks: string, i: number): boolean {
  if (i === 0) return true;
  const sebelum = teks[i - 1];
  if (!HURUF_ANGKA.test(sebelum)) return true;
  return HURUF_ANGKA.test(teks[i]) && ANGKA.test(sebelum) !== ANGKA.test(teks[i]);
}

/** Semua kata ada di `teks` secara berurutan. `diAwalKata` = tiap kata harus
 * mengawali sebuah kata, bukan menempel di tengahnya. */
function cocokBerurutan(teks: string, kata: string[], diAwalKata: boolean): boolean {
  let pos = 0;
  for (const k of kata) {
    let i = teks.indexOf(k, pos);
    while (diAwalKata && i >= 0 && !awalKata(teks, i)) i = teks.indexOf(k, i + 1);
    if (i < 0) return false;
    pos = i + k.length;
  }
  return true;
}

/** Seberapa pas sebuah barang dengan pencarian — makin kecil makin pas, `null` = tidak cocok.
 *
 * - 0: nama barang DIAWALI kata pencarian ("rc" → "RC Kitten 2kg")
 * - 1: kata pencarian mengawali sebuah kata di nama ("rc" → "(non aktif) RC Kitten")
 * - 2: kata pencarian mengawali kode / sebuah bagian kode ("rc" → "RC001", "8997" → "DRC8997…")
 * - 3: longgar — hanya menempel di tengah kata/kode ("rc" → "Curcuma", "DRC8997…")
 *
 * 0–2 disebut cocok "pas"; 3 cocok "longgar". */
export function peringkatCariStok(kata: string[], code: string | null | undefined, name: string | null | undefined): 0 | 1 | 2 | 3 | null {
  if (kata.length === 0) return 0;
  const namaL = (name ?? "").toLowerCase();
  const kodeL = (code ?? "").toLowerCase();
  if (cocokBerurutan(namaL, kata, true)) return namaL.startsWith(kata[0]) ? 0 : 1;
  if (cocokBerurutan(kodeL, kata, true)) return 2;
  if (cocokBerurutan(namaL, kata, false) || cocokBerurutan(kodeL, kata, false)) return 3;
  return null;
}

export type RingkasCariStok = {
  /** Jumlah barang yang cocok pas (peringkat 0–2). */
  pas: number;
  /** Jumlah barang yang hanya cocok longgar (peringkat 3). */
  longgar: number;
  /** Apakah cocokan longgar ikut ditampilkan. */
  tampilLonggar: boolean;
};

/** Menyaring dan mengurutkan barang menurut pencarian.
 *
 * Yang cocok pas selalu di atas (urutan asal dipertahankan di dalam tiap
 * peringkat). Cocokan longgar disembunyikan selama masih ada yang pas — itu yang
 * membuat "RC" menampilkan barang RC saja, bukan semua kode "DRC…" dan nama
 * seperti "Curcuma". Cocokan longgar tetap tampil bila `semua` diminta, atau
 * bila tidak ada satu pun yang pas (supaya potongan kode/barcode tetap bisa
 * dicari dan tidak ada barang yang jadi mustahil ditemukan). */
export function saringCariStok<T>(
  rows: T[], q: string | null | undefined,
  ambil: (row: T) => { code: string | null | undefined; name: string | null | undefined },
  semua = false,
): { baris: T[]; ringkas: RingkasCariStok } {
  const kata = kataCariStok(q);
  if (kata.length === 0) return { baris: rows, ringkas: { pas: rows.length, longgar: 0, tampilLonggar: false } };
  const cocok: { row: T; peringkat: number }[] = [];
  let pas = 0;
  for (const row of rows) {
    const { code, name } = ambil(row);
    const peringkat = peringkatCariStok(kata, code, name);
    if (peringkat === null) continue;
    if (peringkat < 3) pas += 1;
    cocok.push({ row, peringkat });
  }
  const longgar = cocok.length - pas;
  const tampilLonggar = longgar > 0 && (semua || pas === 0);
  const tampil = tampilLonggar ? cocok : cocok.filter((c) => c.peringkat < 3);
  tampil.sort((a, b) => a.peringkat - b.peringkat);
  return { baris: tampil.map((c) => c.row), ringkas: { pas, longgar, tampilLonggar } };
}
