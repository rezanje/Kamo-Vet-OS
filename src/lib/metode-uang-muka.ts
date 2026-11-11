/**
 * Metode pembayaran invoice yang dibayar lewat UANG MUKA (rawat inap / tagihan tahap).
 *
 * Invoice tahap menyimpan `invoices.metode_bayar = 'Tunai'` sebagai nilai bawaan, padahal
 * uangnya masuk lebih dulu lewat kwitansi (QRIS, Transfer, dst.) dan hanya "dipakai" pada
 * tagihan lewat baris `invoice_payments` bermetode "Uang Muka". Jadi kolom itu TIDAK boleh
 * dibaca sebagai metode bayar untuk invoice yang dibayar uang muka.
 *
 * Metode sebenarnya diturunkan di sini dari bagian kwitansi asal uang muka. Kolom tersimpan
 * tidak diubah; buku besar dan total shift sudah memakai bagian kwitansi (bukan kolom ini).
 */
import { METODE_UANG_MUKA } from "@/lib/tagihan-berjalan";

export type PembayaranMetode = {
  id: string; amount: number | string; metode: string | null; transferred_from: string | null;
};
export type BagianMetode = { metode: string; amount: number };
export type RingkasMetode = { judul: string; baris: { label: string; amount: number }[] };

type Db = { from: (table: string) => unknown };
type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const sen = (n: number | string) => Math.round((Number(n) || 0) * 100);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Bagi `nominal` ke metode-metode sebanding bobotnya; hasilnya selalu berjumlah persis `nominal`. */
export function alokasiUangMuka(nominal: number | string, komposisi: readonly BagianMetode[]): BagianMetode[] | null {
  const total = sen(nominal);
  const bobot = komposisi.map((k) => Math.max(0, sen(k.amount)));
  const jumlahBobot = bobot.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !(jumlahBobot > 0)) return null;
  const dasar = bobot.map((b) => Math.floor((total * b) / jumlahBobot));
  let sisa = total - dasar.reduce((a, b) => a + b, 0);
  const urutan = bobot.map((b, i) => ({ i, frac: (total * b) % jumlahBobot }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of urutan) { if (sisa <= 0) break; if (bobot[i] > 0) { dasar[i] += 1; sisa -= 1; } }
  return komposisi.flatMap((k, i) => (dasar[i] > 0 ? [{ metode: k.metode, amount: dasar[i] / 100 }] : []));
}

/**
 * Isi uang muka sebuah kwitansi: bagian kwitansi dikurangi uang yang langsung menutup
 * tagihan (invoice_payments.receipt_id). Sisanya itulah yang menjadi uang muka.
 */
export function komposisiUangMuka(
  bagian: readonly BagianMetode[], langsung: readonly BagianMetode[],
): BagianMetode[] {
  const perMetode = new Map<string, number>();
  for (const b of bagian) perMetode.set(b.metode, (perMetode.get(b.metode) ?? 0) + sen(b.amount));
  const dipakai = new Map<string, number>();
  for (const d of langsung) dipakai.set(d.metode, (dipakai.get(d.metode) ?? 0) + sen(d.amount));
  return [...perMetode].flatMap(([metode, cents]) => {
    const sisa = cents - (dipakai.get(metode) ?? 0);
    return sisa > 0 ? [{ metode, amount: sisa / 100 }] : [];
  });
}

const adalahUangMuka = (p: PembayaranMetode) => p.metode === METODE_UANG_MUKA;

/**
 * Judul + rincian metode untuk satu invoice (struk, invoice cetak, daftar).
 *
 * Uang dibaca dari komponennya: DP di kepala invoice (dengan metode kepala) + baris
 * pembayaran (uang muka diganti metode kwitansi aslinya). Kolom `metode_bayar` hanya
 * dipakai sendirian bila tidak ada satu pun baris pembayaran, yaitu lunas di meja.
 */
export function ringkasMetodeInvoice(
  invoice: { metode_bayar: string | null; dp_amount: number | string | null },
  pembayaran: readonly PembayaranMetode[],
  bagianPerPembayaran: ReadonlyMap<string, readonly BagianMetode[]>,
): RingkasMetode {
  const langsung = pembayaran.filter((p) => !p.transferred_from);

  type Komponen = { label: string; cents: number; uangMuka: string | null | undefined };
  const komponen: Komponen[] = [];
  const tambah = (label: string, cents: number, uangMuka: string | null | undefined) => {
    const ada = komponen.find((k) => k.label === label);
    if (ada) ada.cents += cents; else komponen.push({ label, cents, uangMuka });
  };
  const dp = sen(invoice.dp_amount ?? 0);
  if (dp > 0) tambah(invoice.metode_bayar ?? "DP", dp, undefined);
  for (const p of langsung) {
    if (!adalahUangMuka(p)) { tambah(p.metode ?? "Pembayaran", sen(p.amount), undefined); continue; }
    const bagian = sen(p.amount) > 0 ? bagianPerPembayaran.get(p.id) : undefined;
    if (!bagian?.length) { tambah(METODE_UANG_MUKA, sen(p.amount), null); continue; }
    for (const b of bagian) tambah(`${METODE_UANG_MUKA} (${b.metode})`, sen(b.amount), b.metode);
  }
  const ada = komponen.filter((k) => Math.abs(k.cents) >= 50);
  const baris = ada.map((k) => ({ label: k.label, amount: k.cents / 100 }));
  // Lunas di meja tanpa baris pembayaran (bentuk lama): satu-satunya sumber metode ialah kepala invoice.
  if (ada.length === 0) return { judul: langsung.length === 0 ? invoice.metode_bayar ?? "-" : "-", baris };
  if (ada.length === 1) return { judul: ada[0].label, baris };
  if (ada.every((k) => typeof k.uangMuka === "string")) {
    return { judul: `${METODE_UANG_MUKA} (${ada.map((k) => `${k.uangMuka} ${rp(k.cents / 100)}`).join(" + ")})`, baris };
  }
  return { judul: "Campuran", baris };
}

export function labelMetodeInvoice(
  invoice: { metode_bayar: string | null; dp_amount: number | string | null },
  pembayaran: readonly PembayaranMetode[],
  bagianPerPembayaran: ReadonlyMap<string, readonly BagianMetode[]>,
): string {
  return ringkasMetodeInvoice(invoice, pembayaran, bagianPerPembayaran).judul;
}

type Hasil = { data: unknown[] | null; error: unknown };
type Kueri = PromiseLike<Hasil> & { select: (c: string) => Kueri; in: (c: string, v: string[]) => Kueri };
const dari = (db: Db, tabel: string) => db.from(tabel) as unknown as Kueri;

/**
 * Bagian metode sebenarnya per baris pembayaran "Uang Muka" (kunci = invoice_payments.id).
 *
 * Tanpa pembayaran Uang Muka tidak ada pembacaan sama sekali. Bila ada bacaan yang gagal,
 * hasilnya kosong — tampilan lalu menulis "Uang Muka" apa adanya, tidak menebak metode.
 */
export async function muatBagianUangMuka(
  db: Db,
  invoices: readonly { id: string; payments: readonly PembayaranMetode[] }[],
): Promise<Map<string, BagianMetode[]>> {
  const hasil = new Map<string, BagianMetode[]>();
  const ids = invoices.filter((i) => i.payments.some((p) => !p.transferred_from && adalahUangMuka(p) && Number(p.amount) > 0))
    .map((i) => i.id);
  if (ids.length === 0) return hasil;
  try {
    const apps = await dari(db, "clinic_advance_applications")
      .select("id, invoice_id, payment_id, amount, released_at, clinic_customer_advances(id, amount, receipt_id)")
      .in("invoice_id", ids);
    if (apps.error || !apps.data) return hasil;
    type App = {
      payment_id: string | null; amount: number | string; released_at: string | null;
      clinic_customer_advances: Rel<{ receipt_id: string | null }>;
    };
    const aktif = (apps.data as App[]).filter((a) => a.payment_id && !a.released_at && one(a.clinic_customer_advances)?.receipt_id);
    const receiptIds = [...new Set(aktif.map((a) => one(a.clinic_customer_advances)!.receipt_id as string))];
    if (receiptIds.length === 0) return hasil;
    const [parts, langsung] = await Promise.all([
      dari(db, "clinic_payment_receipt_parts").select("receipt_id, metode, amount").in("receipt_id", receiptIds),
      dari(db, "invoice_payments").select("receipt_id, metode, amount").in("receipt_id", receiptIds),
    ]);
    if (parts.error || langsung.error || !parts.data || !langsung.data) return hasil;
    const group = (rows: unknown[]) => {
      const m = new Map<string, BagianMetode[]>();
      for (const r of rows as { receipt_id: string; metode: string; amount: number | string }[]) {
        m.set(r.receipt_id, [...(m.get(r.receipt_id) ?? []), { metode: r.metode, amount: Number(r.amount) }]);
      }
      return m;
    };
    const bagianKwitansi = group(parts.data);
    const bayarLangsung = group(langsung.data);
    for (const a of aktif) {
      const rid = one(a.clinic_customer_advances)!.receipt_id as string;
      const komposisi = komposisiUangMuka(bagianKwitansi.get(rid) ?? [], bayarLangsung.get(rid) ?? []);
      const bagi = alokasiUangMuka(a.amount, komposisi);
      if (bagi) hasil.set(a.payment_id as string, bagi);
    }
    return hasil;
  } catch {
    return new Map();
  }
}

/**
 * Label metode untuk BANYAK invoice sekaligus (laporan). Hanya invoice yang uangnya lewat
 * baris pembayaran yang ada di hasil; invoice lain (lunas di meja) tetap memakai label kepala.
 * Bacaan dipecah per 100 invoice; bacaan gagal = invoice itu tidak ada di hasil.
 */
export async function muatLabelMetodeInvoice(
  db: Db,
  invoices: readonly { id: string; metode_bayar: string | null; dp_amount: number | string | null }[],
): Promise<Map<string, string>> {
  const hasil = new Map<string, string>();
  for (let i = 0; i < invoices.length; i += 100) {
    const potong = invoices.slice(i, i + 100);
    try {
      const bayar = await dari(db, "invoice_payments").select("id, invoice_id, amount, metode, transferred_from")
        .in("invoice_id", potong.map((p) => p.id));
      if (bayar.error || !bayar.data) continue;
      const perNota = new Map<string, PembayaranMetode[]>();
      for (const p of bayar.data as (PembayaranMetode & { invoice_id: string })[]) {
        perNota.set(p.invoice_id, [...(perNota.get(p.invoice_id) ?? []), p]);
      }
      const bagian = await muatBagianUangMuka(db, potong.map((p) => ({ id: p.id, payments: perNota.get(p.id) ?? [] })));
      for (const inv of potong) {
        const pays = perNota.get(inv.id);
        if (pays?.some((p) => !p.transferred_from)) hasil.set(inv.id, labelMetodeInvoice(inv, pays, bagian));
      }
    } catch { /* potongan ini dilewati */ }
  }
  return hasil;
}
