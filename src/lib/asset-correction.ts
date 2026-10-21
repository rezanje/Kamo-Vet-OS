export type AssetCorrectionPreview = {
  allowed: boolean;
  blockers: string[];
  revision?: number;
  harga_before?: number;
  harga_after?: number;
  tanggal_before?: string;
  tanggal_after?: string;
  monthly_before?: number;
  monthly_after?: number;
  cash_code?: string;
};
