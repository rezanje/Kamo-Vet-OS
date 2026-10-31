import Link from "next/link";
import { infoHalaman } from "@/lib/pagination";
import { ListLoadError } from "@/lib/checked-list";
import { NumberInput } from "@/components/NumberInput";

export function ListLoadFailure({ error, label }: { error: unknown; label: string }) {
  return <div role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>
    {error instanceof ListLoadError ? error.message : `${label} belum dapat dimuat lengkap. Coba muat ulang.`}
  </div>;
}

export function ListPagination({ path, query, total, pageInfo, lompat = true }: {
  path: string;
  query: Record<string, string>;
  total: number;
  pageInfo: ReturnType<typeof infoHalaman>;
  /** false bila daftar dirender DI DALAM form lain (form bersarang tidak sah; tombolnya akan mengirim form luar). */
  lompat?: boolean;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
    params.set("hal", String(page));
    return `${path}?${params}`;
  };
  const filters = Object.entries(query).filter(([key, value]) => value && key !== "hal");
  return <nav aria-label="Halaman daftar" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12, fontSize: 11 }}>
    <span>Menampilkan {total ? pageInfo.from + 1 : 0}–{Math.min(total, pageInfo.to + 1)} dari {total} · Halaman {pageInfo.page}/{pageInfo.totalPages}</span>
    {pageInfo.page > 2 && <Link className="btn-def" href={href(1)}>Pertama</Link>}
    {pageInfo.page > 1 && <Link className="btn-def" href={href(pageInfo.page - 1)}>Sebelumnya</Link>}
    {pageInfo.page < pageInfo.totalPages && <Link className="btn-def" href={href(pageInfo.page + 1)}>Berikutnya</Link>}
    {pageInfo.page < pageInfo.totalPages - 1 && <Link className="btn-def" href={href(pageInfo.totalPages)}>Terakhir</Link>}
    {lompat && pageInfo.totalPages > 2 && (
      // Lompat ke halaman: form GET biasa (tanpa JavaScript), filter daftar yang aktif ikut terbawa.
      <form method="get" action={path} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {filters.map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Ke halaman
          <NumberInput className="fi" name="hal" min={1} max={pageInfo.totalPages} step={1} defaultValue={pageInfo.page}
            inputMode="numeric" required aria-label={`Nomor halaman, 1 sampai ${pageInfo.totalPages}`} style={{ width: 72 }} />
        </label>
        <button className="btn-def" type="submit">Buka</button>
      </form>
    )}
  </nav>;
}
