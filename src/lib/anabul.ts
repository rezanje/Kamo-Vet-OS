// Satu pemilik tidak boleh punya dua anabul AKTIF dengan nama sama.
// Aturannya dikunci di database (index `pets_nama_unik_per_pemilik`, migrasi 0076);
// file ini cuma bikin perilakunya ramah buat staff, bukan jadi satu-satunya penjaga.
//
// Latar: sebelum 0076 layar registrasi diam-diam bikin kartu anabul baru tiap kali
// staff mengetik nama alih-alih memilih dari daftar — riwayat medis satu hewan
// terpecah ke beberapa kartu.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Nama dianggap sama kalau beda cuma di huruf besar/kecil atau spasi pinggir —
// persis aturan index-nya, supaya cek di sini tidak pernah beda hasil dari DB.
export function samaNama(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Kartu anabul aktif milik pemilik ini yang namanya sama. null = belum ada.
export async function cariAnabulSenama(
  supabase: AnyClient,
  customerId: string,
  nama: string,
): Promise<{ id: string; name: string } | null> {
  const cari = nama.trim();
  if (!customerId || !cari) return null;

  // ilike = tidak peka huruf besar/kecil; hasilnya tetap disaring samaNama()
  // karena ilike memperlakukan % dan _ sebagai pola.
  const { data } = await supabase
    .from("pets").select("id, name")
    .eq("customer_id", customerId).eq("status", "Aktif").ilike("name", cari);

  const rows = (data ?? []) as { id: string; name: string }[];
  return rows.find((p) => samaNama(p.name, cari)) ?? null;
}

// Pelanggaran index (balapan dua staff menyimpan bersamaan) → pesan yang sama
// dengan jalur cek biasa, bukan pesan mentah dari database.
export function pesanAnabulKembar(nama: string): string {
  return `"${nama.trim()}" sudah terdaftar sebagai anabul pemilik ini. Pilih dari daftar anabul yang ada, atau beri nama pembeda kalau memang hewan yang berbeda.`;
}

export function errorAnabulKembar(message: string | null | undefined): boolean {
  return !!message && message.includes("pets_nama_unik_per_pemilik");
}

/**
 * Status reproduksi anabul (permintaan drh. Ilham, 25 Agustus 2026).
 *
 * Monorchid = satu testis turun, satunya tertahan. Kriptorkid = dua-duanya tertahan.
 * Keduanya bukan sekadar catatan: pasiennya belum steril TAPI juga tidak normal, dan
 * itu menentukan tindakan bedahnya. Dulu pilihannya cuma Utuh/Steril, jadi kasus
 * begini terpaksa ditulis "Utuh" dan hilang dari data.
 */
export const STATUS_REPRODUKSI = ["Utuh", "Steril", "Monorchid", "Kriptorkid"] as const;
export type StatusReproduksi = (typeof STATUS_REPRODUKSI)[number];
