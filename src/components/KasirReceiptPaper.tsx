import type { ReactNode } from "react";

/**
 * Print rules for the cashier's POS58 receipt, shared by the real receipt and the
 * printer test page so a test print shows exactly what a sale will print.
 *
 * The Windows driver supplies the 58 mm roll size and page length. When that driver
 * setting drifts back to a wider paper (seen at Kamo Petshop Muara, 3 Nov 2026), a
 * centred receipt slides right and the printer cuts off the amounts. Pinning the
 * receipt to the left edge keeps it inside the 48 mm print head whatever paper width
 * the driver reports.
 */
export const KASIR_RECEIPT_PRINT_CSS = `@media print {
  @page { size: auto; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .pos-topbar, .no-print { display: none !important; }
  .kasir-shell { display: block !important; min-height: 0 !important; height: auto !important; background: #fff !important; }
  .kasir-content { padding: 0 !important; overflow: visible !important; }
  .kasir-receipt { padding: 0 !important; border-radius: 0 !important; margin: 0 !important; }
}`;

export function KasirReceiptPaper({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{KASIR_RECEIPT_PRINT_CSS}</style>
      <div className="kasir-receipt" style={{ width: "48mm", maxWidth: "100%", boxSizing: "border-box", margin: "0 auto", background: "#fff", padding: "10px 0", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5, borderRadius: 6, overflowWrap: "anywhere" }}>
        {children}
      </div>
    </>
  );
}

export function ReceiptHr() { return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />; }
export function ReceiptRow({ k, v }: { k: string; v: string }) {
  const money = /^-?Rp /.test(v);
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 4, alignItems: "start" }}>
    <span style={{ minWidth: 0, ...(money ? { flex: "1 1 0" } : { flexShrink: 0, maxWidth: "40%" }) }}>{k}</span>
    <span style={{ minWidth: 0, textAlign: "right", ...(money ? { flexShrink: 0, whiteSpace: "nowrap" as const } : {}) }}>{v}</span>
  </div>;
}
