// Kategori beban → akun COA (sama persis dengan pencatatan pengeluaran kasir; sumber: lib/kategori-pengeluaran).
import { AKUN_KATEGORI_LAMA, AKUN_KATEGORI_PENGELUARAN, KATEGORI_PENGELUARAN_BACKOFFICE } from "@/lib/kategori-pengeluaran";

const SEMUA: Record<string, string> = { ...AKUN_KATEGORI_LAMA, ...AKUN_KATEGORI_PENGELUARAN };
export const KATEGORI_BEBAN: Record<string, string> = Object.fromEntries(
  KATEGORI_PENGELUARAN_BACKOFFICE.map((k) => [k, SEMUA[k]]),
);
