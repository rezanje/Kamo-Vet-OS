export type InventoryAccountingAccount = { id: string; code: string; name: string };

export type InventoryAccountingReceipt = Record<string, unknown>;

export type InventoryAccountingReport = {
  run_id: string;
  status: string;
  source_name: string;
  source_hash: string;
  branch_id: string;
  branch_name: string;
  warehouse_id: string;
  warehouse_name: string;
  as_of: string;
  selected_rows: number;
  excluded_rows: number;
  original_qty: number | string;
  original_value: number | string;
  remaining_value: number | string;
  inventory_account: InventoryAccountingAccount | null;
  equity_account: InventoryAccountingAccount | null;
  blockers: string[];
  can_post: boolean;
  receipt: InventoryAccountingReceipt | null;
  [evidence: string]: unknown;
};

export type InventoryAccountingBatch = {
  id: string;
  source_name: string;
  status: string;
  as_of_date: string | null;
  branch_id: string | null;
  created_at: string;
};

export type InventoryAccountingPreviewResult =
  | { ok: true; report: InventoryAccountingReport }
  | { ok: false; error: string };

export type InventoryAccountingPostResult =
  | { ok: true; receipt: InventoryAccountingReceipt }
  | { ok: false; error: string };
