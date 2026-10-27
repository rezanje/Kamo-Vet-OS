import Link from "next/link";
import type { AdvanceUsage } from "@/lib/advance-usage";

/** Documents that applied one DP; a failed read is never shown as "unused". */
export function AdvanceUsageList({ usages, error, terpakai }: { usages: AdvanceUsage[]; error: boolean; terpakai: number }) {
  const style = { fontSize: 10, fontWeight: 400, marginTop: 4 };
  if (error) return <div role="alert" style={style}>Pemakaian uang muka belum dapat diperiksa. Coba muat ulang.</div>;
  if (!usages.length) return terpakai > 0
    ? <div style={{ ...style, color: "var(--td)" }}>Pemakaian tercatat, tetapi dokumennya tidak tersedia untuk akses Anda.</div> : null;
  return <div style={style}>Dipakai di:
    <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>{usages.map(usage => <li key={usage.id}>
      {usage.href ? <Link href={usage.href}>{usage.label}</Link> : usage.label}
      <span style={{ color: "var(--td)" }}> · {usage.note}</span>
    </li>)}</ul>
  </div>;
}
