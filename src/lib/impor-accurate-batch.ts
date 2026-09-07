export const UKURAN_BATCH_IMPOR = 100;

export type ProgresImpor = {
  phase: "menyiapkan" | "mengimpor" | "selesai";
  completed: number;
  total: number;
  percentage: number;
};

export function bagiImporBatch<T>(rows: T[], ukuran = UKURAN_BATCH_IMPOR): T[][] {
  if (!Number.isInteger(ukuran) || ukuran < 1) throw new Error("Ukuran batch impor tidak valid");
  const batches: T[][] = [];
  for (let start = 0; start < rows.length; start += ukuran) {
    batches.push(rows.slice(start, start + ukuran));
  }
  return batches;
}

export function hitungProgresImpor(completed: number, total: number) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const safeCompleted = Number.isFinite(completed) ? Math.min(safeTotal, Math.max(0, Math.trunc(completed))) : 0;
  return {
    completed: safeCompleted,
    total: safeTotal,
    percentage: safeTotal === 0 ? 100 : Math.round((safeCompleted / safeTotal) * 100),
  };
}

export function bacaProgresDariRingkasan(summary: unknown): ProgresImpor {
  const stored = summary && typeof summary === "object"
    ? (summary as Record<string, unknown>).progress : null;
  const data = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};
  const phase = data.phase === "mengimpor" || data.phase === "selesai" ? data.phase : "menyiapkan";
  return { phase, ...hitungProgresImpor(Number(data.completed), Number(data.total)) };
}
