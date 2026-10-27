import Link from "next/link";
import type { PendingWork } from "@/lib/pending-work";

export function PendingWorkAlerts({ items }: { items: PendingWork[] }) {
  if (items.length === 0) return null;
  return <section className="crm-sec" aria-label="Pekerjaan menunggu keputusan" style={{ marginBottom: 16 }}>
    <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Perlu ditindaklanjuti</h2>
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map(item => <li key={item.href}>
        <Link href={item.href}>{item.label}</Link>: {item.count === null ? "status belum dapat dimuat; buka antrean untuk memeriksa" : `${item.count}${item.hasMore ? "+" : ""} menunggu`}
      </li>)}
    </ul>
  </section>;
}
