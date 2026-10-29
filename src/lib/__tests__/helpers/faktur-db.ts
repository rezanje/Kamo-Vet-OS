// Pengganti Supabase untuk daftar Faktur Penjualan gabungan.
//
// Hanya operator yang benar-benar dipakai pembacanya yang didukung; operator
// asing sengaja melempar supaya tes tidak diam-diam jadi palsu. Batas 1.000
// baris per permintaan ditiru apa adanya — itulah jebakan yang bikin daftar
// panjang terpotong diam-diam kalau pembacanya lalai menghalamani.
export type Row = Record<string, unknown>;
export type JejakBaca = { tabel: string; select: string; dari: number; sampai: number; jumlahId: number;
  /** Saringan yang benar-benar dititipkan ke database, mis. "in:branch_id=b1". */
  ops: string[] };

export type OpsiDbPalsu = {
  jejak?: JejakBaca[];
  /** Tabel yang gagal dibaca. Akhiran ":lanjutan" = hanya halaman kedua dan seterusnya. */
  gagal?: () => string;
  /** Balas tanpa jumlah baris, seperti API yang tidak mengirim count. */
  tanpaCount?: () => boolean;
  /** Batas baris per permintaan, seperti PostgREST. */
  batasApi?: number;
};

export function nilaiKolom(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    const isi = Array.isArray(cur) ? cur[0] : cur;
    return isi == null ? null : (isi as Row)[key];
  }, row);
}

export function bandingNilai(a: unknown, b: unknown): number {
  const pa = Date.parse(String(a)), pb = Date.parse(String(b));
  if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

type SumberBaris = Record<string, Row[]> | ((tabel: string, select: string) => Row[]);

export function buatDbPalsu(sumber: SumberBaris, opsi: OpsiDbPalsu = {}) {
  const batasApi = opsi.batasApi ?? 1000;
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from(tabel: string) {
      const uji: ((row: Row) => boolean)[] = [];
      const urut: { col: string; asc: boolean }[] = [];
      const ops: string[] = [];
      let select = "", dari = 0, sampai = Number.MAX_SAFE_INTEGER, satu = false, jumlahId = 0;
      const saring = (teks: string, f: (row: Row) => boolean) => { ops.push(teks); uji.push(f); return q; };
      const q = {
        select: (kolom = "") => { select = kolom; return q; },
        eq: (col: string, val: unknown) => saring(`eq:${col}`, (row) => String(nilaiKolom(row, col)) === String(val)),
        neq: (col: string, val: unknown) => saring(`neq:${col}`, (row) => String(nilaiKolom(row, col)) !== String(val)),
        gte: (col: string, val: unknown) => saring(`gte:${col}`, (row) => nilaiKolom(row, col) != null && bandingNilai(nilaiKolom(row, col), val) >= 0),
        lte: (col: string, val: unknown) => saring(`lte:${col}`, (row) => nilaiKolom(row, col) != null && bandingNilai(nilaiKolom(row, col), val) <= 0),
        gt: (col: string, val: unknown) => saring(`gt:${col}`, (row) => nilaiKolom(row, col) != null && bandingNilai(nilaiKolom(row, col), val) > 0),
        is: (col: string, val: unknown) => {
          if (val !== null) throw new Error(`is ${val} belum didukung`);
          return saring(`is-null:${col}`, (row) => nilaiKolom(row, col) == null);
        },
        not: (col: string, op: string, val: unknown) => {
          if (op !== "is" || val !== null) throw new Error(`not ${op} belum didukung`);
          return saring(`not-null:${col}`, (row) => nilaiKolom(row, col) != null);
        },
        in: (col: string, list: unknown[]) => {
          jumlahId = Math.max(jumlahId, list.length);
          return saring(`in:${col}=${list.join("|")}`, (row) => list.map(String).includes(String(nilaiKolom(row, col))));
        },
        ilike: (col: string, pola: string) => saring(`ilike:${col}`, (row) =>
          String(nilaiKolom(row, col) ?? "").toLowerCase().includes(pola.replaceAll("%", "").toLowerCase())),
        or: (teks: string) => saring(`or:${teks}`, (row) => teks.split(",").some((bagian) => {
          const potong = bagian.indexOf(".");
          const col = bagian.slice(0, potong), sisa = bagian.slice(potong + 1);
          if (sisa === "is.null") return nilaiKolom(row, col) == null;
          if (sisa === "not.is.null") return nilaiKolom(row, col) != null;
          throw new Error(`or ${bagian} belum didukung`);
        })),
        order: (col: string, opt?: { ascending?: boolean }) => { urut.push({ col, asc: opt?.ascending !== false }); return q; },
        limit: (n: number) => { sampai = n - 1; return q; },
        range: (a: number, b: number) => { dari = a; sampai = b; return q; },
        maybeSingle: () => { satu = true; return q; },
        then<T>(resolve: (value: { data: Row[] | Row | null; count: number | null | undefined; error: unknown }) => T) {
          const semua = typeof sumber === "function" ? sumber(tabel, select) : sumber[tabel];
          if (!semua) throw new Error(`tabel ${tabel} tidak disiapkan di tes`);
          const cocok = semua.filter((row) => uji.every((f) => f(row)));
          for (const { col, asc } of [...urut].reverse()) {
            cocok.sort((a, b) => (asc ? 1 : -1) * bandingNilai(nilaiKolom(a, col), nilaiKolom(b, col)));
          }
          opsi.jejak?.push({ tabel, select, dari, sampai, jumlahId, ops });
          const gagal = opsi.gagal?.() ?? "";
          if (gagal === tabel || (gagal === `${tabel}:lanjutan` && dari > 0)) {
            return Promise.resolve({ data: null, count: null, error: { message: "Kegagalan rekaan" } }).then(resolve);
          }
          if (satu) return Promise.resolve({ data: cocok[0] ?? null, count: null, error: null }).then(resolve);
          const akhir = Math.min(sampai, dari + batasApi - 1);
          return Promise.resolve({
            data: cocok.slice(dari, akhir + 1),
            count: opsi.tanpaCount?.() ? undefined : cocok.length,
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
  };
}
