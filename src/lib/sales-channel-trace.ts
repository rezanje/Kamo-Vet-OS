import { allowedBranchIds } from "./branch-access";
import { readListPage, TABLE_PAGE_SIZE } from "./checked-list";
import { infoHalaman } from "./pagination";

type Rel<T> = T | T[] | null;
export type SaleChannelTrace = {
  id: string;
  no_struk: string | null;
  created_at: string;
  channel: string | null;
  branch_id: string;
  customers: Rel<{ name: string }>;
  branches: Rel<{ name: string }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSalesChannelTrace(db: any, userId: string | null, rawPage: unknown) {
  const branches = userId ? await allowedBranchIds(db, userId) : [];
  if (branches !== null && branches.length === 0) {
    return { rows: [] as SaleChannelTrace[], count: 0, pageInfo: infoHalaman(rawPage, 0, TABLE_PAGE_SIZE) };
  }
  return readListPage<SaleChannelTrace>((from, to) => {
    let query = db.from("sales")
      .select("id,no_struk,created_at,channel,branch_id,customers(name),branches(name)", { count: "exact" })
      .is("voided_at", null)
      .or("payment_plan.is.null,payments_finalized_at.not.is.null");
    if (branches !== null) query = query.in("branch_id", branches);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  }, "Struk POS dan Online", rawPage);
}
