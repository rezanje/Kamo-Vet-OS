// Daftar kategori pelanggan (fixed list). File biasa — BUKAN "use server" —
// karena diimpor dari client component; "use server" cuma boleh export async fn.
export const KATEGORI_OPTIONS = ["Umum", "Member", "B2B", "Rescuer"] as const;
