// Penarikan data berkas pajak satu masa (S10).
//
// Sumbernya JURNAL (akun 2201 PPN Keluaran & 1105 PPN Masukan), bukan tabel dokumen
// satu per satu. Alasannya: berkas pajak harus cocok dengan pembukuan. Kalau ditarik
// dari tabel dokumen, angkanya bisa berbeda dari Rekap PPN dan Neraca — dan waktu
// itu terjadi, tidak ada yang tahu mana yang benar.
//
// Identitas lawan transaksi baru dicari SETELAH itu, dari nomor dokumen yang tertulis
// di jurnalnya. Yang tidak ketemu ditampilkan apa adanya sebagai pembeli umum —
// penjualan eceran di kasir memang begitu.
import { createClient } from "@/lib/supabase/server";
import type { BarisPajak } from "@/lib/faktur-pajak";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const AKUN_KELUARAN = "2201";
const AKUN_MASUKAN = "1105";

export type Perusahaan = { nama: string | null; npwp: string | null; alamat: string | null };

export type HasilPajak = {
  keluaran: BarisPajak[];
  masukan: BarisPajak[];
  perusahaan: Perusahaan;
  modePkp: boolean;
};

/** Akhir bulan sebuah masa YYYY-MM. */
function akhirMasa(masa: string): string {
  const y = Number(masa.slice(0, 4));
  const m = Number(masa.slice(5, 7));
  const hari = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${masa}-${String(hari).padStart(2, "0")}`;
}

export async function tarikPajakMasa(masa: string): Promise<HasilPajak> {
  const supabase = await createClient();
  const dari = `${masa}-01`;
  const sampai = akhirMasa(masa);

  const [{ data: lineRaw }, { data: comp }] = await Promise.all([
    supabase.from("journal_lines")
      .select("debit, credit, coa_accounts!inner(code), journal_entries!inner(tanggal, source, source_ref, deskripsi)")
      .in("coa_accounts.code", [AKUN_KELUARAN, AKUN_MASUKAN])
      .gte("journal_entries.tanggal", dari).lte("journal_entries.tanggal", sampai),
    supabase.from("company_settings")
      .select("nama_perusahaan, npwp, alamat, mode_pkp").eq("id", true).maybeSingle(),
  ]);

  type Line = {
    debit: number; credit: number;
    coa_accounts: Rel<{ code: string }>;
    journal_entries: Rel<{ tanggal: string; source: string; source_ref: string | null; deskripsi: string | null }>;
  };

  // Satu dokumen bisa punya beberapa baris jurnal PPN (mis. koreksi) — dijumlahkan
  // per nomor dokumen supaya berkasnya satu baris per faktur, bukan per baris jurnal.
  type Kumpul = { nomor: string; tanggal: string; ppn: number; deskripsi: string };
  const keluaranPer = new Map<string, Kumpul>();
  const masukanPer = new Map<string, Kumpul>();

  for (const l of (lineRaw ?? []) as unknown as Line[]) {
    const kode = one(l.coa_accounts)?.code;
    const je = one(l.journal_entries);
    if (!kode || !je) continue;

    const nomor = je.source_ref || "(tanpa nomor)";
    const keluaran = kode === AKUN_KELUARAN;
    // PPN keluaran bersaldo kredit, masukan bersaldo debit. Sisi sebaliknya =
    // pembatalan/koreksi, jadi dikurangkan — bukan dibuang.
    const nilai = keluaran
      ? (Number(l.credit) || 0) - (Number(l.debit) || 0)
      : (Number(l.debit) || 0) - (Number(l.credit) || 0);

    const peta = keluaran ? keluaranPer : masukanPer;
    const cur = peta.get(nomor) ?? { nomor, tanggal: je.tanggal, ppn: 0, deskripsi: je.deskripsi ?? "" };
    cur.ppn += nilai;
    if (je.tanggal < cur.tanggal) cur.tanggal = je.tanggal;
    peta.set(nomor, cur);
  }

  const nomorKeluaran = [...keluaranPer.keys()];
  const nomorMasukan = [...masukanPer.keys()];

  // Identitas lawan transaksi dicari dari nomor dokumennya di tiga pintu penjualan
  // dan satu pintu pembelian. Nomor yang tidak ketemu tetap dilaporkan.
  const [{ data: fj }, { data: invKlinik }, { data: pos }, { data: fb }] = await Promise.all([
    nomorKeluaran.length
      ? supabase.from("sales_invoices").select("no_faktur, dpp, ppn, customers(name, address, npwp)").in("no_faktur", nomorKeluaran)
      : Promise.resolve({ data: [] }),
    nomorKeluaran.length
      ? supabase.from("invoices").select("invoice_no, subtotal, discount, tax, visits(customers(name, address, npwp))").in("invoice_no", nomorKeluaran)
      : Promise.resolve({ data: [] }),
    nomorKeluaran.length
      ? supabase.from("sales").select("no_struk, total, customers(name, address, npwp)").in("no_struk", nomorKeluaran)
      : Promise.resolve({ data: [] }),
    nomorMasukan.length
      ? supabase.from("purchase_invoices").select("no_faktur, no_faktur_pemasok, total, suppliers(nama, alamat, npwp)").in("no_faktur", nomorMasukan)
      : Promise.resolve({ data: [] }),
  ]);

  type Pihak = { nama: string; npwp: string | null; alamat: string | null; dpp: number | null; noFakturPajak: string | null };
  const identitas = new Map<string, Pihak>();

  type FjRow = { no_faktur: string; dpp: number; ppn: number; customers: Rel<{ name: string; address: string | null; npwp: string | null }> };
  for (const r of (fj ?? []) as unknown as FjRow[]) {
    const c = one(r.customers);
    identitas.set(r.no_faktur, {
      nama: c?.name ?? "(tanpa pelanggan)", npwp: c?.npwp ?? null, alamat: c?.address ?? null,
      dpp: Number(r.dpp) || 0, noFakturPajak: null,
    });
  }

  type InvRow = { invoice_no: string | null; subtotal: number; discount: number; tax: number; visits: Rel<{ customers: Rel<{ name: string; address: string | null; npwp: string | null }> }> };
  for (const r of (invKlinik ?? []) as unknown as InvRow[]) {
    if (!r.invoice_no) continue;
    const c = one(one(r.visits)?.customers ?? null);
    identitas.set(r.invoice_no, {
      nama: c?.name ?? "(pelanggan umum)", npwp: c?.npwp ?? null, alamat: c?.address ?? null,
      dpp: Math.max(0, (Number(r.subtotal) || 0) - (Number(r.discount) || 0)), noFakturPajak: null,
    });
  }

  type PosRow = { no_struk: string | null; total: number; customers: Rel<{ name: string; address: string | null; npwp: string | null }> };
  for (const r of (pos ?? []) as unknown as PosRow[]) {
    if (!r.no_struk) continue;
    const c = one(r.customers);
    identitas.set(r.no_struk, {
      nama: c?.name ?? "(pembeli umum)", npwp: c?.npwp ?? null, alamat: c?.address ?? null,
      // Harga kasir sudah termasuk PPN; DPP-nya = total dikurangi PPN yang dijurnal.
      dpp: null, noFakturPajak: null,
    });
  }

  type FbRow = { no_faktur: string; no_faktur_pemasok: string | null; total: number; suppliers: Rel<{ nama: string; alamat: string | null; npwp: string | null }> };
  for (const r of (fb ?? []) as unknown as FbRow[]) {
    const s = one(r.suppliers);
    identitas.set(r.no_faktur, {
      nama: s?.nama ?? "(tanpa pemasok)", npwp: s?.npwp ?? null, alamat: s?.alamat ?? null,
      dpp: Math.max(0, (Number(r.total) || 0)), noFakturPajak: r.no_faktur_pemasok,
    });
  }

  const susun = (k: Kumpul): BarisPajak => {
    const p = identitas.get(k.nomor);
    return {
      nomor: k.nomor,
      tanggal: k.tanggal,
      pihak: p?.nama ?? k.deskripsi.slice(0, 60) ?? "—",
      npwp: p?.npwp ?? null,
      alamat: p?.alamat ?? null,
      noFakturPajak: p?.noFakturPajak ?? null,
      // DPP dokumen dipakai kalau ada; kalau tidak (mis. struk kasir), DPP = nilai
      // dokumen dikurangi PPN-nya, dihitung dari jurnal yang sama.
      dpp: p?.dpp ?? 0,
      ppn: k.ppn,
    };
  };

  const urut = (a: BarisPajak, b: BarisPajak) =>
    a.tanggal.localeCompare(b.tanggal) || a.nomor.localeCompare(b.nomor);

  return {
    keluaran: [...keluaranPer.values()].map(susun).filter((r) => r.ppn !== 0).sort(urut),
    masukan: [...masukanPer.values()].map(susun).filter((r) => r.ppn !== 0).sort(urut),
    perusahaan: {
      nama: (comp?.nama_perusahaan as string | null) ?? null,
      npwp: (comp?.npwp as string | null) ?? null,
      alamat: (comp?.alamat as string | null) ?? null,
    },
    modePkp: !!comp?.mode_pkp,
  };
}
