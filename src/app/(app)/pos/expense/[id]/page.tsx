import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

type Expense = {
  id: string;
  tanggal: string;
  kategori: string;
  deskripsi: string | null;
  jumlah: number;
  metode_bayar: string;
  branches: Rel<{ name: string }>;
  pembuat: Rel<{ full_name: string | null }>;
};

export default async function ExpenseDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("expenses")
    .select("id, tanggal, kategori, deskripsi, jumlah, metode_bayar, branches(name), pembuat:created_by(full_name)")
    .eq("id", id)
    .maybeSingle();

  const exp = data as unknown as Expense | null;
  if (!exp) notFound();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/expense" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Detail Pengeluaran</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Dokumen tersimpan.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{exp.kategori}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtTgl(exp.tanggal)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".03em" }}>Jumlah</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{rp(Number(exp.jumlah))}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Info label="Cabang" value={one(exp.branches)?.name ?? "—"} />
          <Info label="Metode bayar" value={exp.metode_bayar} />
          <Info label="Dibuat oleh" value={one(exp.pembuat)?.full_name ?? "—"} />
          <Info label="Deskripsi" value={exp.deskripsi ?? "—"} />
        </div>
      </div>

      <DokumenPanel modul="pengeluaran" refId={exp.id} kembali={`/pos/expense/${exp.id}`} judul="BUKTI & DOKUMEN" />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
