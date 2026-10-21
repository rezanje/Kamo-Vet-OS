import type { ItemUnit } from "@/lib/satuan";

const qty = (value: number) => value.toLocaleString("id-ID", { maximumFractionDigits: 6 });

export function WarehouseStockHint({ warehouseId, quantity, baseUnit, selectedUnit }: {
  warehouseId: string; quantity: number; baseUnit: string; selectedUnit?: ItemUnit;
}) {
  const factor = Number(selectedUnit?.factor) || 1;
  const unit = selectedUnit?.unit || baseUnit;
  return <div role="status" aria-live="polite" style={{ fontSize: 10, color: "var(--tm)", marginTop: 4 }}>
    {warehouseId ? <>Stok tersedia: {qty(quantity / factor)} {unit}{factor !== 1 && ` (${qty(quantity)} ${baseUnit})`}</> : "Pilih gudang untuk melihat stok."}
  </div>;
}
