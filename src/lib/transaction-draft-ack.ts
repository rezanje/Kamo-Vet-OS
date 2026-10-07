/** Draft acknowledgement only; this is not a financial posting idempotency key. */
export function transactionDraftAck(formData: FormData): string {
  const key = String(formData.get("draft_key") ?? "");
  const scope = String(formData.get("draft_scope") ?? "");
  return key && key.length <= 120 && scope && scope.length <= 200
    ? `&draft_done=${encodeURIComponent(key)}&draft_scope=${encodeURIComponent(scope)}` : "";
}

type ExpectedJournal = { deskripsi?: string; source: string; sourceRef: string; tanggal: string; branchId?: string | null; lines: {code: string; debit: number; credit: number}[] };
/** Verify the complete journal for this document before retiring its draft. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertDraftJournal(supabase: any, expected: ExpectedJournal): Promise<void> {
  const {data,error} = await supabase.from("journal_entries")
    .select("id,tanggal,branch_id,journal_lines(debit,credit,coa_accounts(code))")
    .eq("source", expected.source).eq("source_ref", expected.sourceRef)
    .order("created_at", {ascending: false}).limit(1);
  const entry = data?.[0];
  const canonical = (lines: {code: string;debit: number;credit: number}[]) => JSON.stringify(lines
    .filter(line => line.debit > 0 || line.credit > 0)
    .map(line => [line.code,Number(line.debit),Number(line.credit)]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const actual = (entry?.journal_lines ?? []).map((line: {debit: unknown;credit: unknown;coa_accounts: {code: string}|{code:string}[]|null}) => ({
    code: (Array.isArray(line.coa_accounts) ? line.coa_accounts[0] : line.coa_accounts)?.code ?? "",
    debit: Number(line.debit), credit: Number(line.credit),
  }));
  if (error || !entry || actual.some((line: {debit:number;credit:number}) => !Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0) || entry.tanggal !== expected.tanggal || (entry.branch_id ?? null) !== (expected.branchId ?? null)
    || canonical(actual) !== canonical(expected.lines)) {
    throw new Error("Jurnal transaksi belum terkonfirmasi lengkap. Periksa dokumen dan jurnal sebelum menyimpan ulang.");
  }
}
