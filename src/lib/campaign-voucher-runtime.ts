import { readCompleteList } from "./checked-list";
import { normalizeKode, type VoucherRow } from "./voucher";

// The database exposes only chosen transaction aliases to active staff. The
// manager configuration table keeps its existing restricted RLS policy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
type Alias = { id: string; code: string; voucher_code: string };

export async function campaignVoucherPreview(supabase: Client, vouchers: VoucherRow[]): Promise<VoucherRow[]> {
  const aliases = await readCompleteList<Alias>(async (from, to) => {
    const result = await supabase.rpc("campaign_voucher_aliases", {}, { count: "exact" }).range(from, to);
    return { ...result, data: result.data?.map((row: { code: string; voucher_code: string }) => ({ ...row, id: row.code })) ?? null };
  }, "Alias voucher kampanye", { maxRows: null });
  const byCode = new Map(vouchers.map(v => [v.code, v]));
  return [...vouchers, ...aliases.flatMap(alias => {
    const source = byCode.get(alias.voucher_code);
    return source ? [{ ...source, code: alias.code, campaign_alias: true }] : [];
  })];
}

export async function resolveCampaignVoucher(supabase: Client, rawCode: unknown): Promise<{ voucherCode: string | null; campaignCode: string | null }> {
  const submitted = normalizeKode(rawCode) || null;
  if (!submitted) return { voucherCode: null, campaignCode: null };
  const { data, error } = await supabase.rpc("campaign_voucher_aliases", { p_code: submitted });
  if (error) throw new Error(error.message.includes("CAMPAIGN_MODE_NOT_AVAILABLE")
    ? "Mode kode kampanye belum tersedia untuk pembayaran ini."
    : "Kode kampanye belum dapat diverifikasi. Muat ulang dan coba lagi.");
  const target = (data as { code: string; voucher_code: string }[] | null)?.[0];
  return target
    ? { voucherCode: target.voucher_code, campaignCode: submitted }
    : { voucherCode: submitted, campaignCode: null };
}
