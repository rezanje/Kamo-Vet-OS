// Agregasi buku besar dari journal_lines + coa_accounts. Read-only, hitung di JS
// (volume prototype kecil). Saldo per akun mengikuti sifat saldo normal.
// Semua fungsi menerima filter periode (from/to, inklusif) + cabang.

import { kodeSemuaRekening } from "./kas-akun";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type LedgerFilter = { from?: string; to?: string; branchId?: string; branchIds?: string[] };

export type AccountBalance = {
  id: string;
  code: string; name: string; type: string; normal: string;
  debit: number; credit: number; saldo: number;
  /** Struktur induk–rincian (migrasi 0113). */
  parent_id: string | null; is_header: boolean;
};

const TYPE_ORDER = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"];

// Sisi normal "alami" tiap kelompok akun di neraca/laba rugi.
const SISI_SEKSI: Record<string, "D" | "K"> = {
  ASET: "D", LIABILITAS: "K", EKUITAS: "K", PENDAPATAN: "K", BEBAN: "D",
};

// Nilai sebuah akun DILIHAT DARI kelompoknya, bukan dari sisi normal akunnya sendiri.
//
// Perlu karena ada akun kontra: Akumulasi Penyusutan (1509) bertipe ASET tapi bersaldo
// normal Kredit. Kalau saldonya dijumlahkan apa adanya, akumulasi penyusutan malah
// MENAMBAH total aktiva. Aturan ini membuatnya otomatis jadi pengurang, tanpa perlu
// daftar kode akun kontra yang harus dirawat manual.
export function nilaiSeksi(b: { type: string; normal: string; saldo: number }): number {
  const sisi = SISI_SEKSI[b.type] ?? "D";
  return b.normal === sisi ? b.saldo : -b.saldo;
}

type RawLine = {
  account_id: string; debit: number; credit: number;
  journal_entries: { tanggal: string; branch_id: string | null; source: string; no_jurnal: string | null; deskripsi: string | null } | null;
};

// Satu jalur query untuk semua laporan — join inner ke journal_entries supaya
// filter tanggal/cabang berlaku konsisten.
async function fetchLines(supabase: AnyClient, f?: LedgerFilter): Promise<RawLine[]> {
  // branchIds: undefined = tanpa filter cabang; [] (allow-list eksplisit kosong) = tidak ada
  // baris yang cocok, BUKAN "semua cabang" — mis. preset unit:ONLINE saat tidak ada cabang
  // bertipe ONLINE. Jangan sampai array kosong jatuh ke default "tanpa filter".
  if (f?.branchIds && f.branchIds.length === 0) return [];

  let q = supabase
    .from("journal_lines")
    .select("account_id, debit, credit, journal_entries!inner(tanggal, branch_id, source, no_jurnal, deskripsi)");
  if (f?.from) q = q.gte("journal_entries.tanggal", f.from);
  if (f?.to) q = q.lte("journal_entries.tanggal", f.to);
  if (f?.branchId) q = q.eq("journal_entries.branch_id", f.branchId);
  if (f?.branchIds?.length) q = q.in("journal_entries.branch_id", f.branchIds);
  const { data } = await q;
  return ((data ?? []) as RawLine[]).map((r) => ({
    ...r,
    journal_entries: Array.isArray(r.journal_entries) ? r.journal_entries[0] : r.journal_entries,
  }));
}

export async function getAccountBalances(supabase: AnyClient, f?: LedgerFilter): Promise<AccountBalance[]> {
  const [{ data: accs }, lines] = await Promise.all([
    supabase.from("coa_accounts").select("id, code, name, type, normal_balance, parent_id, is_header") as Promise<{ data: { id: string; code: string; name: string; type: string; normal_balance: string; parent_id: string | null; is_header: boolean }[] | null }>,
    fetchLines(supabase, f),
  ]);

  const agg = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const cur = agg.get(l.account_id) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debit);
    cur.credit += Number(l.credit);
    agg.set(l.account_id, cur);
  }

  return (accs ?? [])
    .map((a) => {
      const m = agg.get(a.id) ?? { debit: 0, credit: 0 };
      const saldo = a.normal_balance === "D" ? m.debit - m.credit : m.credit - m.debit;
      return {
        id: a.id, code: a.code, name: a.name, type: a.type, normal: a.normal_balance,
        debit: m.debit, credit: m.credit, saldo,
        parent_id: a.parent_id ?? null, is_header: !!a.is_header,
      };
    })
    .sort((x, y) => (TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type)) || x.code.localeCompare(y.code));
}

export type LedgerLine = { tanggal: string; no_jurnal: string; deskripsi: string; source: string; debit: number; credit: number };

// Tanggal sehari sebelum `tanggal` — dipakai untuk memotong "posisi sebelum periode".
// String-math, bukan new Date(), supaya tidak bergeser di server non-WIB.
function hariSebelum(tanggal: string): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Saldo satu akun SEBELUM tanggal `from` (mengikuti sisi saldo normal).
// Tanpa ini kolom "saldo berjalan" di Buku Besar mulai dari nol setiap kali periode
// difilter — angkanya jadi bukan saldo akun, cuma jumlah mutasi dalam rentang.
export async function getAccountOpening(supabase: AnyClient, code: string, f?: LedgerFilter): Promise<number> {
  if (!f?.from) return 0;
  const { data: accs } = (await supabase.from("coa_accounts").select("id, normal_balance").eq("code", code)) as
    { data: { id: string; normal_balance: string }[] | null };
  const acc = accs?.[0];
  if (!acc) return 0;

  const lines = await fetchLines(supabase, { to: hariSebelum(f.from), branchId: f.branchId, branchIds: f.branchIds });
  let debit = 0, credit = 0;
  for (const l of lines) {
    if (l.account_id !== acc.id) continue;
    debit += Number(l.debit);
    credit += Number(l.credit);
  }
  return acc.normal_balance === "D" ? debit - credit : credit - debit;
}

// Mutasi satu akun (untuk buku besar detail), urut tanggal — saldo berjalan dihitung di page.
export async function getAccountLedger(supabase: AnyClient, code: string, f?: LedgerFilter): Promise<LedgerLine[]> {
  const { data: accs } = (await supabase.from("coa_accounts").select("id").eq("code", code)) as { data: { id: string }[] | null };
  const accId = accs?.[0]?.id;
  if (!accId) return [];

  const lines = await fetchLines(supabase, f);
  const rows = lines
    .filter((l) => l.account_id === accId)
    .map((r) => ({
      tanggal: r.journal_entries?.tanggal ?? "",
      no_jurnal: r.journal_entries?.no_jurnal ?? "",
      deskripsi: r.journal_entries?.deskripsi ?? "",
      source: r.journal_entries?.source ?? "manual",
      debit: Number(r.debit),
      credit: Number(r.credit),
    }));
  rows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_jurnal.localeCompare(b.no_jurnal));
  return rows;
}

// Arus kas metode langsung: mutasi jurnal yang menyentuh akun kas/bank (1101,1102),
// dikelompokkan per source. masuk = debit ke kas, keluar = credit dari kas.
// saldoAwal = posisi kas sebelum `from` (supaya laporan per periode tetap nyambung).
export type CashMove = { source: string; masuk: number; keluar: number };

async function cashAccountIds(supabase: AnyClient): Promise<Set<string>> {
  // Daftar rekening dibaca dari master, bukan kode mati ["1101","1102"] — rekening
  // yang ditambah belakangan (Mandiri, QRIS, e-wallet) harus ikut terhitung sebagai kas.
  const kode = await kodeSemuaRekening(supabase);
  const { data } = (await supabase.from("coa_accounts").select("id, code").in("code", kode)) as { data: { id: string }[] | null };
  return new Set((data ?? []).map((a) => a.id));
}

export async function getCashMovements(
  supabase: AnyClient,
  f?: LedgerFilter,
): Promise<{ moves: CashMove[]; saldoKasNow: number; saldoAwal: number }> {
  const cashIds = await cashAccountIds(supabase);
  if (cashIds.size === 0) return { moves: [], saldoKasNow: 0, saldoAwal: 0 };

  const lines = await fetchLines(supabase, f);
  const agg = new Map<string, CashMove>();
  let saldo = 0;
  for (const l of lines) {
    if (!cashIds.has(l.account_id)) continue;
    const src = l.journal_entries?.source ?? "manual";
    const cur = agg.get(src) ?? { source: src, masuk: 0, keluar: 0 };
    cur.masuk += Number(l.debit);
    cur.keluar += Number(l.credit);
    agg.set(src, cur);
    saldo += Number(l.debit) - Number(l.credit);
  }

  // saldo kas sebelum periode (kalau ada batas bawah).
  let saldoAwal = 0;
  if (f?.from) {
    // Filter cabang harus IKUT dibawa (termasuk branchIds/preset unit) — kalau tidak,
    // saldo awal dihitung se-perusahaan sementara mutasinya per cabang.
    const before = await fetchLines(supabase, { to: hariSebelum(f.from), branchId: f.branchId, branchIds: f.branchIds });
    for (const l of before) {
      if (!cashIds.has(l.account_id)) continue;
      saldoAwal += Number(l.debit) - Number(l.credit);
    }
  }

  return { moves: [...agg.values()], saldoKasNow: saldo + saldoAwal, saldoAwal };
}

// Rincian arus kas PER REKENING — pelengkap getCashMovements yang hanya meringkas
// per sumber transaksi. Yang dicari di sini: rekening mana menerima/mengeluarkan apa,
// lengkap dengan saldo berjalannya. Semua rekening ditarik dalam satu tarikan jurnal,
// bukan satu query per rekening.
export type RekeningMutasi = {
  code: string;
  nama: string;
  jenis: string;
  saldoAwal: number;
  masuk: number;
  keluar: number;
  saldoAkhir: number;
  mutasi: (LedgerLine & { saldo: number })[];
};

export async function getCashLedgerPerAccount(
  supabase: AnyClient,
  f?: LedgerFilter,
): Promise<RekeningMutasi[]> {
  const [{ data: rek }, lines] = await Promise.all([
    supabase.from("cash_accounts").select("nama, jenis, coa_code").eq("is_active", true).order("jenis").order("nama") as
      Promise<{ data: { nama: string; jenis: string; coa_code: string }[] | null }>,
    fetchLines(supabase, f),
  ]);
  const rekening = rek ?? [];
  if (rekening.length === 0) return [];

  const kode = [...new Set(rekening.map((r) => r.coa_code))];
  const { data: accs } = (await supabase.from("coa_accounts").select("id, code").in("code", kode)) as
    { data: { id: string; code: string }[] | null };
  const kodePerId = new Map((accs ?? []).map((a) => [a.id, a.code]));

  const awalPerKode = new Map<string, number>();
  if (f?.from) {
    const before = await fetchLines(supabase, { to: hariSebelum(f.from), branchId: f.branchId, branchIds: f.branchIds });
    for (const l of before) {
      const c = kodePerId.get(l.account_id);
      if (!c) continue;
      awalPerKode.set(c, (awalPerKode.get(c) ?? 0) + Number(l.debit) - Number(l.credit));
    }
  }

  const mutasiPerKode = new Map<string, LedgerLine[]>();
  for (const l of lines) {
    const c = kodePerId.get(l.account_id);
    if (!c) continue;
    const arr = mutasiPerKode.get(c) ?? [];
    arr.push({
      tanggal: l.journal_entries?.tanggal ?? "",
      no_jurnal: l.journal_entries?.no_jurnal ?? "",
      deskripsi: l.journal_entries?.deskripsi ?? "",
      source: l.journal_entries?.source ?? "manual",
      debit: Number(l.debit),
      credit: Number(l.credit),
    });
    mutasiPerKode.set(c, arr);
  }

  // Satu kode akun bisa dipakai beberapa rekening (mis. dua e-wallet menunjuk 1103).
  // Dalam kasus itu mutasinya memang tidak bisa dipisah — namanya digabung apa adanya
  // supaya tidak terlihat seperti dua rekening yang masing-masing punya saldo penuh.
  const namaPerKode = new Map<string, { nama: string[]; jenis: string }>();
  for (const r of rekening) {
    const cur = namaPerKode.get(r.coa_code) ?? { nama: [], jenis: r.jenis };
    cur.nama.push(r.nama);
    namaPerKode.set(r.coa_code, cur);
  }

  return [...namaPerKode].map(([code, info]) => {
    const rows = (mutasiPerKode.get(code) ?? []).sort(
      (a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_jurnal.localeCompare(b.no_jurnal),
    );
    const saldoAwal = awalPerKode.get(code) ?? 0;
    let saldo = saldoAwal;
    const mutasi = rows.map((r) => {
      saldo += r.debit - r.credit;
      return { ...r, saldo };
    });
    const masuk = rows.reduce((a, r) => a + r.debit, 0);
    const keluar = rows.reduce((a, r) => a + r.credit, 0);
    return {
      code, nama: info.nama.join(" + "), jenis: info.jenis,
      saldoAwal, masuk, keluar, saldoAkhir: saldoAwal + masuk - keluar, mutasi,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
}
