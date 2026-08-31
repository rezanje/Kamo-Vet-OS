import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardBlock } from "@/lib/operation-sales-server";

export function rupiah(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function angka(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function persen(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${angka(value, 1)}%`;
}

export function detailHref(path: string, filter: { from: string; to: string; branchName?: string }): string {
  const params = new URLSearchParams({ dari: filter.from, sampai: filter.to });
  if (filter.branchName) params.set("cabang", filter.branchName);
  return `${path}?${params.toString()}`;
}

export function KpiCard({ label, value, note, href, tone }: {
  label: string;
  value: string;
  note?: string;
  href?: string;
  tone?: string;
}) {
  const content = (
    <>
      <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone ?? "var(--sb)", marginTop: 3 }}>{value}</div>
      {note && <div style={{ fontSize: 9.5, color: "var(--tm)", marginTop: 4 }}>{note}</div>}
    </>
  );
  return href
    ? <Link href={href} className="crm-sec" style={{ margin: 0, minWidth: 150, flex: "1 1 150px", textDecoration: "none" }}>{content}</Link>
    : <div className="crm-sec" style={{ margin: 0, minWidth: 150, flex: "1 1 150px" }}>{content}</div>;
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>{children}</div>;
}

export function BlockState<T>({ block, children }: { block: DashboardBlock<T>; children: (data: T) => ReactNode }) {
  if (block.status === "missing") {
    return <div className="crm-sec" style={{ margin: 0, color: "var(--tm)", fontSize: 11 }}>Data belum tersedia. {block.reason}.</div>;
  }
  if (block.status === "error") {
    return <div className="crm-sec" style={{ margin: 0, color: "#b91c1c", fontSize: 11 }}>Blok ini gagal dimuat. ID pelacakan: {block.correlationId}</div>;
  }
  return <>{children(block.data)}</>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="crm-sec" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}

export function EmptyRow({ columns, text = "Data belum tersedia" }: { columns: number; text?: string }) {
  return <tr><td colSpan={columns} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>{text}</td></tr>;
}
