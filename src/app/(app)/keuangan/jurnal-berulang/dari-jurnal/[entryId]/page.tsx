import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { firstRecurringSourcePeriod, currentRecurringSourcePeriod } from "@/lib/recurring-source";
import { SourceRecurringForm } from "../../SourceRecurringForm";

type SourceLine = { line_id: string; account_id: string; code: string; debit: number; credit: number };
type Source = {
  entry_id: string; no_jurnal: string; tanggal: string; branch_id: string | null; revision: number;
  source: string; deskripsi: string | null; voided_at: string | null; version: string; lines: SourceLine[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function JurnalSumberSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entryId } = await params;
  const { error: formError } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let error = formError || "";
  let source: Source | null = null;
  let branchName = "Pusat";
  if (user && UUID.test(entryId)) {
    const { data, error: previewError } = await supabase.rpc("preview_recurring_journal_source", { p_entry_id: entryId });
    if (previewError) {
      error ||= previewError.code === "42501"
        ? "Jurnal sumber tidak ditemukan atau cabang ini tidak dapat diakses."
        : previewError.message || "Jurnal sumber belum dapat diperiksa.";
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      source = data as unknown as Source;
      if (source.entry_id !== entryId || !["manual", "manual-correction"].includes(source.source)
        || source.voided_at || !Array.isArray(source.lines) || !source.lines.length) {
        source = null;
        error = "Jurnal ini tidak memenuhi syarat sebagai sumber jadwal berkala.";
      } else if (source.branch_id) {
        const { data: branch } = await supabase.from("branches").select("name").eq("id", source.branch_id).maybeSingle();
        branchName = branch?.name ?? "Cabang jurnal sumber";
      }
    } else error ||= "Pratinjau jurnal sumber tidak lengkap. Muat ulang daftar jurnal.";
  } else if (!user) error = "Masuk kembali untuk memeriksa jurnal sumber.";
  else if (!UUID.test(entryId)) error = "Identitas jurnal sumber tidak valid.";

  const now = new Date();
  let first = "";
  let current = "";
  if (source) {
    try {
      first = firstRecurringSourcePeriod(source.tanggal, now);
      current = currentRecurringSourcePeriod(now);
    } catch {
      source = null;
      error = "Tanggal jurnal sumber tidak valid untuk membuat jadwal.";
    }
  }

  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(entryId)}`} className="back-btn"><i className="ti ti-arrow-left" /> Jurnal sumber</Link>
      <span style={{ color: "var(--td)" }}>·</span><span style={{ fontSize: 13, fontWeight: 500 }}>Jadwal dari jurnal</span>
    </div>
    {error && <div className="p2ban" role="alert" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>{error}</div>}
    {!user && <div className="p2ban" role="alert">Sesi pengguna tidak tersedia.</div>}
    {source && user && <>
      <div className="p2ban" style={{ background: "#f8fafc", border: ".5px solid #cbd5e1" }}>Cabang sumber: <strong>{branchName}</strong>. Nilai dan akun berasal dari jurnal tersimpan; jadwal belum membuat jurnal atau pembayaran.</div>
      <SourceRecurringForm userId={user.id} source={source} firstPeriod={first} currentPeriod={current} />
    </>}
    <div style={{ marginTop: 12 }}><Link href="/keuangan/jurnal-berulang" className="back-btn">Lihat jadwal jurnal</Link></div>
  </>;
}
