// Siapa yang boleh memberi DISKON MANUAL (keputusan pemilik 29 Oktober 2026:
// "kasir ga boleh pasang diskon manual, harus yang punya akses").
//
// SATU tempat memutuskannya, dipakai layar, server action, dan — lewat
// `public.can_manual_discount()` — database. Mengubah daftar peran cukup di sini
// dan di kolom `role_capabilities.manual_discount` (layar Akses Grup).
//
// Yang DIHITUNG sebagai diskon manual:
//   * potongan per baris yang diketik kasir (rupiah atau persen);
//   * diskon tingkat nota/tagihan yang diketik kasir;
//   * "diskon default barang" bila angkanya DIUBAH dari master.
// Yang TIDAK: promo otomatis, voucher, kode kampanye, diskon golongan pelanggan,
// dan diskon default barang yang masih persis seperti di master.

/** Bawaan: pemilik, admin kantor, dan keuangan. Kasir (STAFF) & dokter tidak. */
export const PERAN_DISKON_MANUAL = ["OWNER", "ADMIN", "FINANCE"] as const;

/** Satu kalimat yang dipakai layar maupun server action — jangan dikarang ulang. */
export const PESAN_DISKON_MANUAL = "Diskon manual hanya untuk akun berwenang";

/** Nama kemampuan di `role_capabilities` dan di `public.has_role_capability()`. */
export const KEMAMPUAN_DISKON_MANUAL = "manual_discount";

/** Aturan bawaan sebuah peran, sebelum pemilik mengubahnya di layar Akses Grup. */
export function bolehDiskonManualBawaan(role: string): boolean {
  return (PERAN_DISKON_MANUAL as readonly string[]).includes(role);
}

/** Keputusan akhir: bawaan peran, kecuali pemilik sudah menyetel sendiri. */
export function bolehDiskonManual(
  role: string | null | undefined,
  tersimpan?: { manual_discount?: boolean | null } | null,
): boolean {
  if (!role) return false; // gagal tertutup: peran tidak terbaca = tidak boleh
  if (role === "OWNER") return true; // pemilik tidak bisa mengunci dirinya sendiri
  return tersimpan?.manual_discount ?? bolehDiskonManualBawaan(role);
}

/**
 * Baca hak diskon manual pengguna yang sedang login.
 *
 * Gagal tertutup: profil tidak terbaca / akun nonaktif = tidak boleh. Dipanggil
 * HANYA saat transaksinya benar-benar memuat diskon manual, supaya transaksi
 * biasa tidak menanggung pembacaan tambahan.
 */
export async function bacaAksesDiskonManual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
  if (error || !data?.is_active || !data?.role) return false;
  if (data.role === "OWNER") return true;
  const { data: baris, error: capError } = await client
    .from("role_capabilities").select(KEMAMPUAN_DISKON_MANUAL).eq("role", data.role).maybeSingle();
  if (capError) return false;
  return bolehDiskonManual(data.role, baris ?? null);
}

// ---------------------------------------------------------------------------
// Klasifikasi diskon per baris kasir petshop
// ---------------------------------------------------------------------------

export type DiskonBaris = {
  item_discount_type?: "nominal" | "percent" | null;
  item_discount_value?: number | null;
};

/** Diskon baris yang MEMANG berasal dari master barang (persen, 0 = tanpa diskon). */
export function diskonBawaanBaris(diskonDefault: number): Required<DiskonBaris> {
  const persen = Math.max(0, Number(diskonDefault) || 0);
  return persen > 0
    ? { item_discount_type: "percent", item_discount_value: persen }
    : { item_discount_type: null, item_discount_value: 0 };
}

/**
 * Baris ini memakai diskon manual?
 *
 * `diskonDefault` diambil dari master barang di SERVER (temuan audit S-6) — nilai
 * yang dikirim layar tidak pernah menentukan apa yang dianggap "bawaan".
 * Baris ketikan bebas (tanpa item_id) bawaannya selalu 0.
 */
export function barisDiskonManual(baris: DiskonBaris, diskonDefault: number): boolean {
  const bawaan = diskonBawaanBaris(diskonDefault);
  const nilai = Math.max(0, Number(baris.item_discount_value) || 0);
  if (bawaan.item_discount_value === 0) return nilai > 0;
  return !(baris.item_discount_type === "percent" && nilai === bawaan.item_discount_value);
}
