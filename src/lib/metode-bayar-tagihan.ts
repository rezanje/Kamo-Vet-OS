/**
 * Cara bayar SEBENARNYA untuk tagihan rawat inap bertahap (`invoices.stage_billing`).
 *
 * Tagihan bertahap diterbitkan dulu dengan label kepala `metode_bayar = 'Tunai'` sebagai
 * pengisi; uangnya baru masuk belakangan lewat kwitansi per kunjungan (boleh campuran,
 * boleh beberapa kali), lalu dialokasikan ke tagihan sebagai:
 *   - baris pembayaran langsung dari kwitansi (metode = metode bagian kwitansi), atau
 *   - "Pemakaian uang muka" (metode = 'Uang Muka') — uangnya berasal dari kwitansi yang
 *     membentuk uang muka itu.
 * Label kepala tidak pernah diperbarui, sehingga faktur/struk/laporan menulis "Tunai"
 * walau pelanggan membayar dengan kartu (kasus Chloe, Klinik TKI, 2 Nov 2026).
 *
 * Fungsi ini hanya MEMBACA dan hanya untuk tampilan. Uang, jurnal dan tutup shift sudah
 * memakai bagian kwitansi yang benar dan tidak disentuh.
 */

type Db = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const METODE_CAMPURAN = "Campuran";
const UANG_MUKA = "Uang Muka";

/** Satu metode → metode itu; lebih dari satu → "Campuran"; tidak ada → null. */
export function labelMetodeBayar(metode: Iterable<string | null | undefined>): string | null {
  const unik = Array.from(new Set(Array.from(metode).filter((m): m is string => !!m && m.trim() !== "")));
  if (unik.length === 0) return null;
  return unik.length === 1 ? unik[0] : METODE_CAMPURAN;
}

type BarisBayar = { invoice_id: string; amount: number | string; metode: string | null };
type Penerapan = { invoice_id: string; advance_id: string; released_at: string | null };
type UangMuka = { id: string; receipt_id: string | null };
type Kwitansi = { id: string; status: string; clinic_payment_receipt_parts: { metode: string | null }[] | null };

/** Inti murni (diuji terpisah): kumpulkan metode per tagihan dari data yang sudah dibaca. */
export function susunMetodeTagihan(
  invoiceIds: readonly string[],
  bayar: readonly BarisBayar[],
  penerapan: readonly Penerapan[],
  uangMuka: readonly UangMuka[],
  kwitansi: readonly Kwitansi[],
): Map<string, string> {
  const ids = new Set(invoiceIds);
  const metode = new Map<string, Set<string>>();
  const tambah = (invoiceId: string, m: string | null | undefined) => {
    if (!m) return;
    const set = metode.get(invoiceId) ?? new Set<string>();
    set.add(m);
    metode.set(invoiceId, set);
  };

  // Bayar langsung: jumlahkan BERSIH per metode supaya kwitansi yang dibatalkan
  // (baris pembalik bernilai minus) tidak ikut menyebut metodenya.
  const bersih = new Map<string, number>();
  for (const b of bayar) {
    if (!ids.has(b.invoice_id) || !b.metode || b.metode === UANG_MUKA) continue;
    const key = `${b.invoice_id}\u0000${b.metode}`;
    bersih.set(key, (bersih.get(key) ?? 0) + (Number(b.amount) || 0));
  }
  for (const [key, nilai] of bersih) {
    if (nilai <= 0) continue;
    const [invoiceId, m] = key.split("\u0000");
    tambah(invoiceId, m);
  }

  // Uang muka: telusuri ke kwitansi pembentuknya. Penerapan yang dilepas dan kwitansi
  // yang dibatalkan tidak dihitung.
  const kwitansiUangMuka = new Map(uangMuka.map((u) => [u.id, u.receipt_id]));
  const bagianKwitansi = new Map(kwitansi
    .filter((k) => k.status === "aktif")
    .map((k) => [k.id, (k.clinic_payment_receipt_parts ?? []).map((p) => p.metode)]));
  for (const p of penerapan) {
    if (!ids.has(p.invoice_id) || p.released_at) continue;
    const receiptId = kwitansiUangMuka.get(p.advance_id);
    for (const m of (receiptId && bagianKwitansi.get(receiptId)) || []) tambah(p.invoice_id, m);
  }

  const hasil = new Map<string, string>();
  for (const [invoiceId, set] of metode) {
    const label = labelMetodeBayar(set);
    if (label) hasil.set(invoiceId, label);
  }
  return hasil;
}

/**
 * Label cara bayar untuk tagihan bertahap. Tagihan yang tidak bisa ditelusuri (atau
 * gagal dibaca) TIDAK ada di hasil — pemanggil memakai label kepala seperti sebelumnya.
 */
export async function metodeBayarTagihanBertahap(db: Db, invoiceIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(invoiceIds.filter(Boolean)));
  if (!ids.length) return new Map();
  // Laporan rentang panjang bisa membawa ratusan tagihan: pecah supaya filter `in` tetap pendek.
  const potongan: string[][] = [];
  for (let i = 0; i < ids.length; i += UKURAN_POTONGAN) potongan.push(ids.slice(i, i + UKURAN_POTONGAN));
  const hasil = await Promise.all(potongan.map((bagian) => telusurPotongan(db, bagian)));
  return new Map(hasil.flatMap((m) => Array.from(m)));
}

const UKURAN_POTONGAN = 100;

async function telusurPotongan(db: Db, ids: string[]): Promise<Map<string, string>> {
  try {
    const [bayarRes, penerapanRes] = await Promise.all([
      db.from("invoice_payments").select("invoice_id, amount, metode").in("invoice_id", ids),
      db.from("clinic_advance_applications").select("invoice_id, advance_id, released_at").in("invoice_id", ids),
    ]);
    if (bayarRes?.error) return new Map();
    const penerapan = (penerapanRes?.error ? [] : (penerapanRes?.data ?? [])) as Penerapan[];
    const advanceIds = Array.from(new Set(penerapan.map((p) => p.advance_id)));
    let uangMuka: UangMuka[] = [];
    let kwitansi: Kwitansi[] = [];
    if (advanceIds.length) {
      const umRes = await db.from("clinic_customer_advances").select("id, receipt_id").in("id", advanceIds);
      uangMuka = (umRes?.error ? [] : (umRes?.data ?? [])) as UangMuka[];
      const receiptIds = Array.from(new Set(uangMuka.map((u) => u.receipt_id).filter((id): id is string => !!id)));
      if (receiptIds.length) {
        const kRes = await db.from("clinic_payment_receipts")
          .select("id, status, clinic_payment_receipt_parts(metode)").in("id", receiptIds);
        kwitansi = (kRes?.error ? [] : (kRes?.data ?? [])) as Kwitansi[];
      }
    }
    return susunMetodeTagihan(ids, (bayarRes?.data ?? []) as BarisBayar[], penerapan, uangMuka, kwitansi);
  } catch {
    return new Map();
  }
}

/** Label tampil: hasil telusur untuk tagihan bertahap, selain itu label kepala. */
export function metodeTampil(
  invoice: { id: string; metode_bayar: string | null; stage_billing?: boolean | null },
  telusur: ReadonlyMap<string, string>,
): string | null {
  return (invoice.stage_billing && telusur.get(invoice.id)) || invoice.metode_bayar;
}
