"use client";

import { useRouter } from "next/navigation";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function AccountLedgerRow({ row, href, selected }: {
  row: { code: string; name: string; type: string; debit: number; credit: number; saldo: number };
  href: string;
  selected: boolean;
}) {
  const router = useRouter();
  const open = () => router.push(href);
  return (
    <tr onClick={open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(); }}
      tabIndex={0} role="link" title="Buka rincian mutasi"
      style={{ background: selected ? "rgba(217,119,87,.06)" : undefined, cursor: "pointer" }}>
      <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--tm)" }}>{row.code}</td>
      <td style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>{row.name}</td>
      <td style={{ fontSize: 10, color: "var(--tm)" }}>{row.type}</td>
      <td style={{ textAlign: "right", fontSize: 11 }}>{row.debit ? rp(row.debit) : "—"}</td>
      <td style={{ textAlign: "right", fontSize: 11 }}>{row.credit ? rp(row.credit) : "—"}</td>
      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp(row.saldo)}</td>
      <td><i className="ti ti-chevron-right" aria-hidden="true" /></td>
    </tr>
  );
}

