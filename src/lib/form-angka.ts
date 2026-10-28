// Angka isian form yang WAJIB diketik. Kosong / bukan angka = null, bukan 0 —
// supaya kolom yang dibiarkan kosong tidak diam-diam tersimpan sebagai nol
// atau angka bawaan. Mengetik "0" tetap sah.
export function angkaIsian(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
