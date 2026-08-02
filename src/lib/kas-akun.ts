// Peta metode bayar → rekening kas/bank (migrasi 0085).
//
// Satu-satunya tempat yang boleh memutuskan "uang ini masuk akun mana". Sebelumnya
// ±15 server action menulis sendiri `metode === "Tunai" ? "1101" : "1102"`, sehingga
// semua pembayaran non-tunai menumpuk di satu rekening.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Metode di kasir (shift-calc) + "Transfer" yang cuma dipakai layar keuangan.
export const METODE_BAYAR = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

export const KODE_KAS_BAWAAN = "1101";
export const KODE_BANK_BAWAAN = "1102";

export type PetaBaris = { metode: string; branch_id: string | null; coa_code: string };

// Bawaan lama dipertahankan supaya selama peta belum diisi, angka persis sama
// dengan sebelum fitur ini ada.
export function kodeBawaan(metode: string): string {
  return metode === "Tunai" ? KODE_KAS_BAWAAN : KODE_BANK_BAWAAN;
}

// Urutan: aturan cabang → aturan pusat → bawaan.
export function pilihKodeAkun(peta: PetaBaris[], metode: string, branchId: string | null): string {
  const cocok = peta.filter((p) => p.metode === metode);
  const cabang = branchId ? cocok.find((p) => p.branch_id === branchId) : undefined;
  if (cabang) return cabang.coa_code;
  const pusat = cocok.find((p) => p.branch_id === null);
  if (pusat) return pusat.coa_code;
  return kodeBawaan(metode);
}

type PetaRow = { metode: string; branch_id: string | null; cash_accounts: { coa_code: string } | { coa_code: string }[] | null };

function ratakan(rows: PetaRow[]): PetaBaris[] {
  return rows.flatMap((r) => {
    const rek = Array.isArray(r.cash_accounts) ? r.cash_accounts[0] : r.cash_accounts;
    return rek ? [{ metode: r.metode, branch_id: r.branch_id, coa_code: rek.coa_code }] : [];
  });
}

export async function bacaPeta(supabase: AnyClient): Promise<PetaBaris[]> {
  const { data } = await supabase
    .from("payment_account_map")
    .select("metode, branch_id, cash_accounts(coa_code)");
  return ratakan((data ?? []) as PetaRow[]);
}

// Pintu tunggal untuk server action. `accountId` = rekening yang dipilih manual di
// layar keuangan; kalau ada, dia menang atas peta.
export async function kodeAkunBayar(
  supabase: AnyClient,
  metode: string,
  branchId: string | null,
  accountId?: string | null,
): Promise<string> {
  if (accountId) {
    const { data } = await supabase
      .from("cash_accounts").select("coa_code").eq("id", accountId).eq("is_active", true);
    const kode = ((data ?? []) as { coa_code: string }[])[0]?.coa_code;
    if (kode) return kode;
  }
  return pilihKodeAkun(await bacaPeta(supabase), metode, branchId);
}

// Jurnal pembalikan (void/edit) harus membalik ke akun kas yang BENAR-BENAR dipakai
// jurnal aslinya. Kalau peta rekening diubah setelah transaksi dibuat, menghitung ulang
// dari peta akan membalik ke rekening lain — saldo dua rekening jadi salah sekaligus.
export async function kodeKasJurnalAsal(
  supabase: AnyClient,
  source: string,
  sourceRef: string,
  fallback: string,
): Promise<string> {
  const { data } = await supabase
    .from("journal_lines")
    .select("coa_accounts!inner(code), journal_entries!inner(source, source_ref)")
    .eq("journal_entries.source", source)
    .eq("journal_entries.source_ref", sourceRef);

  const rekening = new Set(await kodeSemuaRekening(supabase));
  type Row = { coa_accounts: { code: string } | { code: string }[] | null };
  for (const row of (data ?? []) as Row[]) {
    const akun = Array.isArray(row.coa_accounts) ? row.coa_accounts[0] : row.coa_accounts;
    if (akun?.code && rekening.has(akun.code)) return akun.code;
  }
  return fallback;
}

// Kode akun semua rekening kas/bank — dipakai laporan arus kas & kartu kas dashboard,
// yang dulu memakai daftar mati ["1101","1102"] sehingga rekening baru tidak terhitung.
export async function kodeSemuaRekening(supabase: AnyClient): Promise<string[]> {
  const { data } = await supabase.from("cash_accounts").select("coa_code");
  const kode = ((data ?? []) as { coa_code: string }[]).map((r) => r.coa_code);
  return kode.length > 0 ? kode : [KODE_KAS_BAWAAN, KODE_BANK_BAWAAN];
}
