// Filter daftar Persediaan kasir (Permintaan/Penerimaan Barang) disimpan di alamat, bukan hanya di state
// komponen, supaya membuka detail lalu Kembali (tautan atau tombol browser) tidak mengulang dari awal.
export type PersediaanFilterAwal = { status?: string; dari?: string; sampai?: string; cari?: string; hal?: string };
export type PersediaanFilter = { status: string; from: string; to: string; q: string; page: number };

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Baca filter dari parameter alamat; nilai tidak sah diabaikan (jadi "semua"). */
export function filterDariAlamat(awal: PersediaanFilterAwal | undefined, statusSah: readonly string[]): PersediaanFilter {
  const status = awal?.status && statusSah.includes(awal.status) ? awal.status : "";
  const from = awal?.dari && TANGGAL.test(awal.dari) ? awal.dari : "";
  const to = awal?.sampai && TANGGAL.test(awal.sampai) ? awal.sampai : "";
  const q = (awal?.cari ?? "").slice(0, 80);
  const hal = Number.parseInt(awal?.hal ?? "1", 10);
  return { status, from, to, q, page: Number.isFinite(hal) && hal > 1 ? hal : 1 };
}

/** Query baru: parameter lain (mis. tab) dipertahankan, parameter filter dipasang/dibuang. */
export function queryDenganFilter(search: string, f: PersediaanFilter): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const set = (key: string, value: string) => { if (value) params.set(key, value); else params.delete(key); };
  set("status", f.status);
  set("dari", f.from);
  set("sampai", f.to);
  set("cari", f.q.trim());
  set("hal", f.page > 1 ? String(f.page) : "");
  const query = params.toString();
  return query ? `?${query}` : "";
}
