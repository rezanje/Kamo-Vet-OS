import Link from "next/link";
import { infoHalaman } from "@/lib/pagination";
import { ListLoadError } from "@/lib/checked-list";

export function ListLoadFailure({ error, label }: { error: unknown; label: string }) {
  return <div role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>
    {error instanceof ListLoadError ? error.message : `${label} belum dapat dimuat lengkap. Coba muat ulang.`}
  </div>;
}

export function ListPagination({ path, query, total, pageInfo }: {
  path: string;
  query: Record<string, string>;
  total: number;
  pageInfo: ReturnType<typeof infoHalaman>;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
    params.set("hal", String(page));
    return `${path}?${params}`;
  };
  return <nav aria-label="Halaman daftar" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12, fontSize: 11 }}>
    <span>Menampilkan {total ? pageInfo.from + 1 : 0}–{Math.min(total, pageInfo.to + 1)} dari {total} · Halaman {pageInfo.page}/{pageInfo.totalPages}</span>
    {pageInfo.page > 1 && <Link className="btn-def" href={href(pageInfo.page - 1)}>Sebelumnya</Link>}
    {pageInfo.page < pageInfo.totalPages && <Link className="btn-def" href={href(pageInfo.page + 1)}>Berikutnya</Link>}
  </nav>;
}
