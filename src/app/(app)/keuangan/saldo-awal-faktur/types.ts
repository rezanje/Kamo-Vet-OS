import type { BarisSaldoAwalFaktur } from "@/lib/saldo-awal-faktur";

export type OpeningInvoicePayload = {
  source_name: string;
  as_of: string;
  branch_id: string;
  control: { hutang: string | null; piutang: string | null };
  rows: BarisSaldoAwalFaktur[];
};

export type OpeningInvoiceRowReport = {
  baris: number; jenis: string; kode_pihak: string | null; nama_pihak: string;
  party_id: string | null; party_name: string | null; matched_by: string | null;
  no_faktur: string; tanggal: string | null; jatuh_tempo: string | null;
  sisa: number | null; total_asli: number | null; keterangan: string | null; errors: string[];
};

export type OpeningInvoiceTotals = { jumlah_faktur: number; total: number; kontrol: number | null };

export type OpeningInvoiceReceipt = {
  batch_id: string; journal_id: string; no_jurnal: string; as_of: string; replayed?: boolean;
  hutang: { jumlah_faktur: number; total: number }; piutang: { jumlah_faktur: number; total: number };
};

export type OpeningInvoiceReport = {
  source_hash: string; source_name: string; as_of: string; branch_id: string; branch_name: string;
  status: "previewed" | "posted"; receipt: OpeningInvoiceReceipt | null;
  rows: OpeningInvoiceRowReport[];
  parties: { jenis: string; party_id: string | null; nama: string; jumlah_faktur: number; total: number }[];
  error_rows: number; blockers: string[];
  totals: { hutang: OpeningInvoiceTotals; piutang: OpeningInvoiceTotals };
  can_post: boolean;
};

export type OpeningInvoicePreviewResult =
  | { ok: true; report: OpeningInvoiceReport; payload: OpeningInvoicePayload }
  | { ok: false; error: string };

export type OpeningInvoicePostResult =
  | { ok: true; receipt: OpeningInvoiceReceipt }
  | { ok: false; error: string };
