import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDateTime = (s: string) => new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

// Sumber jurnal → label + warna badge (audit trail).
const SRC: Record<string, { label: string; cls: string }> = {
  manual: { label: "Jurnal manual", cls: "x" },
  expense: { label: "Beban", cls: "o" },
  sale: { label: "Penjualan POS", cls: "b" },
  "sale-hpp": { label: "HPP penjualan", cls: "b" },
  shift: { label: "Selisih kas", cls: "g" },
  klinik: { label: "Invoice klinik", cls: "g" },
  "klinik-edit": { label: "Edit invoice", cls: "o" },
  "klinik-void": { label: "Void invoice", cls: "r" },
  "klinik-ar": { label: "Pelunasan piutang", cls: "g" },
  purchase: { label: "Penerimaan barang", cls: "b" },
  "purchase-pay": { label: "Bayar hutang", cls: "o" },
  "stock-in": { label: "Stok masuk", cls: "b" },
  payroll: { label: "Penggajian", cls: "x" },
  "bank-rec": { label: "Rekonsiliasi bank", cls: "b" },
  asset: { label: "Aset tetap", cls: "x" },
  depreciation: { label: "Penyusutan", cls: "x" },
};

const PAGE = 40;

export default async function LogJurnalPage({ searchParams }: { searchParams: Promise<{ src?: string; page?: string }> }) {
  const { src, page } = await searchParams;
  const p = Math.max(0, Number(page) || 0);
  const supabase = await createClient();

  let q = supabase
    .from("journal_entries")
    .select("id, no_jurnal, tanggal, deskripsi, source, source_ref, created_at, journal_lines(debit)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(p * PAGE, p * PAGE + PAGE - 1);
  if (src) q = q.eq("source", src);
  const { data: entries, count } = await q;

  const rows = (entries ?? []).map((e) => {
    const lines = (e.journal_lines ?? []) as { debit: number }[];
    const total = lines.reduce((a, l) => a + Number(l.debit), 0);
    return { ...e, total };
  });

  const totalHal = Math.ceil((count ?? 0) / PAGE);
  const sources = Object.keys(SRC);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/buku-besar" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Log Aktifitas Jurnal</span>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="LOG AKTIFITAS JURNAL" desc={`Jejak audit seluruh jurnal — ${count ?? 0} entri. Setiap transaksi otomatis tercatat di sini.`} />

        <form method="get" action="/buku-besar/log" style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <label className="flab">Sumber transaksi</label>
            <select className="fi" name="src" defaultValue={src ?? ""} style={{ width: 200 }}>
              <option value="">Semua sumber</option>
              {sources.map((s) => <option key={s} value={s}>{SRC[s].label}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def" style={{ padding: "7px 14px", fontSize: 11 }}><i className="ti ti-filter" /> Terapkan</button>
          {src && <Link href="/buku-besar/log" className="back-btn" style={{ fontSize: 11 }}>Reset</Link>}
        </form>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 700 }}>
            <thead>
              <tr><th>Waktu</th><th>No. Jurnal</th><th>Sumber</th><th>Keterangan</th><th>Ref</th><th style={{ textAlign: "right" }}>Nilai</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const badge = SRC[e.source] ?? { label: e.source, cls: "x" };
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{fmtDateTime(e.created_at)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>{e.no_jurnal}</td>
                    <td><span className={`bge ${badge.cls}`}>{badge.label}</span></td>
                    <td style={{ fontSize: 11.5, maxWidth: 240 }}>{e.deskripsi}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10, color: "var(--td)" }}>{e.source_ref ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp(e.total)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada jurnal.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalHal > 1 && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 12, fontSize: 11 }}>
            {p > 0 && <Link href={`/buku-besar/log?${src ? `src=${src}&` : ""}page=${p - 1}`} className="btn-def" style={{ padding: "5px 12px", textDecoration: "none" }}>‹ Sebelumnya</Link>}
            <span style={{ color: "var(--tm)" }}>Halaman {p + 1} / {totalHal}</span>
            {p + 1 < totalHal && <Link href={`/buku-besar/log?${src ? `src=${src}&` : ""}page=${p + 1}`} className="btn-def" style={{ padding: "5px 12px", textDecoration: "none" }}>Berikutnya ›</Link>}
          </div>
        )}
      </div>
    </>
  );
}
