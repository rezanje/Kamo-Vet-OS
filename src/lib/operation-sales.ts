import { transaksiValid } from "./laporan-transaksi";

export type Channel = "all" | "pos" | "online" | "reseller" | "klinik";

export type DashboardFilter = {
  from: string;
  to: string;
  branchIds: string[];
  channel: Channel;
};

export type PeriodPreset = "today" | "mtd" | "custom";

export type Period = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
};

export type SalesMetricRow = {
  saleId: string;
  qty: number;
  net: number;
  cost: number;
  status: string;
};

export type SalesMetric = {
  sales: number;
  transactions: number;
  units: number;
  atv: number | null;
  upt: number | null;
  grossMargin: number;
};

export type BranchPerformance = {
  branchId: string;
  branchName: string;
  sales: number;
  achievement: number | null;
  growth: number | null;
  transactions: number;
  atv: number | null;
  grossMargin: number;
  uniqueCustomers: number;
};

export type MetricValue =
  | { status: "ready"; value: number }
  | { status: "missing"; reason: string };

export type SalesTargetRow = {
  period: string;
  amount: number;
  branchId: string | null;
  employeeId: string | null;
  categoryId: string | null;
};

export type CustomerTransactionRow = {
  customerId: string | null;
  saleId: string;
  date: string;
  net: number;
  status: string;
  species?: string | null;
};

export type CustomerClassification = {
  newCustomers: number;
  repeatCustomers: number;
  activeCustomers: number;
  dormantCustomers: number;
  spending: Record<string, number>;
  frequency: Record<string, number>;
  speciesSegments: Record<string, number>;
};

export type MovementRow = {
  itemId: string;
  soldQty: number;
  stockQty: number;
  lastSoldAt: string | null;
};

export type MovementResult = {
  fast: MovementRow[];
  slow: MovementRow[];
};

export type StockLayerRow = {
  qtyLeft: number;
  unitCost: number;
};

export type PurchaseQuantityRow = {
  orderedQty: number;
  receivedQty: number;
};

export type SupplierPerformanceRow = {
  supplierId: string;
  supplierName: string;
  purchased: number;
  orderedQty: number;
  receivedQty: number;
  returned: number;
  poDate: string | null;
  receivedDate: string | null;
};

export type SupplierPerformance = {
  supplierId: string;
  supplierName: string;
  purchased: number;
  fillRate: number | null;
  returned: number;
  averageLeadDays: number | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dateValue(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime()
    : null;
}

function dateText(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const parsed = dateValue(value);
  return dateText((parsed ?? Date.UTC(2000, 0, 1)) + days * 86_400_000);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function validDateOr(value: string | undefined, fallback: string): string {
  return value && dateValue(value) !== null ? value : fallback;
}

export function buildPeriod(input: {
  preset: PeriodPreset | string;
  now: string;
  from?: string;
  to?: string;
}): Period {
  const now = validDateOr(input.now, "2000-01-01");
  let from: string;
  let to: string;

  if (input.preset === "today") {
    from = now;
    to = now;
  } else if (input.preset === "custom") {
    const customFrom = validDateOr(input.from, "");
    const customTo = validDateOr(input.to, "");
    if (customFrom && customTo && (dateValue(customFrom) ?? 0) <= (dateValue(customTo) ?? 0)) {
      from = customFrom;
      to = customTo;
    } else {
      from = `${now.slice(0, 7)}-01`;
      to = now;
    }
  } else {
    from = `${now.slice(0, 7)}-01`;
    to = now;
  }

  const fromValue = dateValue(from) ?? dateValue(now) ?? Date.UTC(2000, 0, 1);
  const toValue = dateValue(to) ?? fromValue;
  const days = Math.floor((toValue - fromValue) / 86_400_000) + 1;

  if (input.preset === "mtd" || (input.preset !== "custom" && input.preset !== "today")) {
    const year = Number(now.slice(0, 4));
    const month = Number(now.slice(5, 7)) - 1;
    const previousYear = month === 0 ? year - 1 : year;
    const previousMonth = month === 0 ? 11 : month - 1;
    const previousDay = Math.min(Number(to.slice(8, 10)), lastDayOfMonth(previousYear, previousMonth));
    return {
      from,
      to,
      previousFrom: `${previousYear}-${String(previousMonth + 1).padStart(2, "0")}-01`,
      previousTo: `${previousYear}-${String(previousMonth + 1).padStart(2, "0")}-${String(previousDay).padStart(2, "0")}`,
    };
  }

  const previousTo = addDays(from, -1);
  return { from, to, previousFrom: addDays(previousTo, -(days - 1)), previousTo };
}

export function isValidSalesStatus(status: string): boolean {
  return transaksiValid(status);
}

export function salesMetrics(rows: SalesMetricRow[]): SalesMetric {
  const valid = rows.filter((row) => isValidSalesStatus(row.status));
  const transactions = new Set(valid.map((row) => row.saleId)).size;
  const sales = valid.reduce((total, row) => total + (Number(row.net) || 0), 0);
  const units = valid.reduce((total, row) => total + (Number(row.qty) || 0), 0);
  const cost = valid.reduce((total, row) => total + (Number(row.cost) || 0), 0);

  return {
    sales,
    transactions,
    units,
    atv: transactions ? sales / transactions : null,
    upt: transactions ? units / transactions : null,
    grossMargin: sales - cost,
  };
}

export function growthPercent(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function targetAchievement(realized: number, target: number | null | undefined): number | null {
  if (target === null || target === undefined || target <= 0) return null;
  return (realized / target) * 100;
}

export function resolveSalesTarget(rows: SalesTargetRow[], branchIds: string[], period: string): number | null {
  const applicable = rows.filter((row) => row.period === period && row.amount > 0);
  const companyRows = applicable.filter((row) => !row.branchId && !row.employeeId && !row.categoryId);
  if (companyRows.length > 0) return companyRows.reduce((total, row) => total + row.amount, 0);

  const allowed = new Set(branchIds);
  const branchRows = applicable.filter(
    (row) => row.branchId && allowed.has(row.branchId) && !row.employeeId && !row.categoryId,
  );
  return branchRows.length > 0 ? branchRows.reduce((total, row) => total + row.amount, 0) : null;
}

export function classifyCustomers(
  rows: CustomerTransactionRow[],
  period: { from: string; to: string },
  dormancyDays: number,
  asOf: string,
): CustomerClassification {
  const valid = rows.filter((row) => row.customerId && isValidSalesStatus(row.status) && dateValue(row.date) !== null);
  const byCustomer = new Map<string, CustomerTransactionRow[]>();
  for (const row of valid) {
    const customerRows = byCustomer.get(row.customerId!);
    if (customerRows) customerRows.push(row);
    else byCustomer.set(row.customerId!, [row]);
  }

  const spending: Record<string, number> = {};
  const frequency: Record<string, number> = {};
  const speciesSets = new Map<string, Set<string>>();
  let newCustomers = 0;
  let repeatCustomers = 0;
  let activeCustomers = 0;
  let dormantCustomers = 0;
  const periodFrom = dateValue(period.from) ?? 0;
  const periodTo = dateValue(period.to) ?? 0;
  const cutoff = (dateValue(asOf) ?? 0) - Math.max(0, dormancyDays) * 86_400_000;

  for (const [customerId, customerRows] of byCustomer) {
    const ordered = [...customerRows].sort((a, b) => (dateValue(a.date)! - dateValue(b.date)!));
    const periodRows = ordered.filter((row) => {
      const timestamp = dateValue(row.date)!;
      return timestamp >= periodFrom && timestamp <= periodTo;
    });
    const first = dateValue(ordered[0].date)!;
    const last = dateValue(ordered[ordered.length - 1].date)!;

    if (periodRows.length > 0) {
      spending[customerId] = periodRows.reduce((total, row) => total + (Number(row.net) || 0), 0);
      if (first >= periodFrom && first <= periodTo) newCustomers++;
      if (ordered.length >= 2) repeatCustomers++;
      const activeDays = Math.max(1, Math.floor((last - first) / 86_400_000) + 1);
      frequency[customerId] = ordered.length / activeDays;
    }

    if (last >= cutoff) activeCustomers++;
    else dormantCustomers++;

    const species = new Set(
      ordered.map((row) => row.species?.trim()).filter((value): value is string => Boolean(value)),
    );
    if (species.size > 0) speciesSets.set(customerId, species);
  }

  const speciesSegments: Record<string, number> = {};
  for (const species of speciesSets.values()) {
    for (const value of species) speciesSegments[value] = (speciesSegments[value] ?? 0) + 1;
  }

  return {
    newCustomers,
    repeatCustomers,
    activeCustomers,
    dormantCustomers,
    spending,
    frequency,
    speciesSegments,
  };
}

export function rankMovement(
  rows: MovementRow[],
  asOf: string,
  slowThresholdDays: number,
  fastShare = 0.2,
): MovementResult {
  const sold = rows.filter((row) => row.soldQty > 0).sort((a, b) => b.soldQty - a.soldQty || a.itemId.localeCompare(b.itemId));
  const fastCount = Math.ceil(fastShare * sold.length);
  const cutoff = (dateValue(asOf) ?? 0) - Math.max(0, slowThresholdDays) * 86_400_000;
  const slow = rows
    .filter((row) => row.stockQty > 0 && (row.lastSoldAt === null || (dateValue(row.lastSoldAt) ?? 0) < cutoff))
    .sort((a, b) => (b.stockQty - a.stockQty) || a.itemId.localeCompare(b.itemId));
  return { fast: sold.slice(0, fastCount), slow };
}

export function stockValue(rows: StockLayerRow[]): number {
  return rows.reduce((total, row) => total + (Number(row.qtyLeft) || 0) * (Number(row.unitCost) || 0), 0);
}

export function stockCoverage(availableBaseQty: number, usageQty: number, days = 90): number | null {
  if (usageQty <= 0 || days <= 0) return null;
  return (availableBaseQty * days) / usageQty;
}

export function outstandingPoQty(rows: PurchaseQuantityRow[]): number {
  return rows.reduce((total, row) => total + Math.max(0, (Number(row.orderedQty) || 0) - (Number(row.receivedQty) || 0)), 0);
}

export function supplierPerformance(rows: SupplierPerformanceRow[]): SupplierPerformance[] {
  const grouped = new Map<string, {
    supplierName: string;
    purchased: number;
    orderedQty: number;
    receivedQty: number;
    returned: number;
    leadDays: number[];
  }>();

  for (const row of rows) {
    const current = grouped.get(row.supplierId) ?? {
      supplierName: row.supplierName,
      purchased: 0,
      orderedQty: 0,
      receivedQty: 0,
      returned: 0,
      leadDays: [],
    };
    current.purchased += Number(row.purchased) || 0;
    current.orderedQty += Number(row.orderedQty) || 0;
    current.receivedQty += Number(row.receivedQty) || 0;
    current.returned += Number(row.returned) || 0;
    const po = row.poDate ? dateValue(row.poDate) : null;
    const received = row.receivedDate ? dateValue(row.receivedDate) : null;
    if (po !== null && received !== null && received >= po) current.leadDays.push((received - po) / 86_400_000);
    grouped.set(row.supplierId, current);
  }

  return [...grouped.entries()]
    .map(([supplierId, value]) => ({
      supplierId,
      supplierName: value.supplierName,
      purchased: value.purchased,
      fillRate: value.orderedQty > 0 ? value.receivedQty / value.orderedQty : null,
      returned: value.returned,
      averageLeadDays: value.leadDays.length > 0
        ? value.leadDays.reduce((total, days) => total + days, 0) / value.leadDays.length
        : null,
    }))
    .sort((a, b) => b.purchased - a.purchased || a.supplierName.localeCompare(b.supplierName));
}
