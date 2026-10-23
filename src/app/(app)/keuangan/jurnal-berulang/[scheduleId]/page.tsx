import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { recurringSourceDue, recurringSourcePeriodIndex, recurringSourceProgress, recurringSourceWindow } from "@/lib/recurring-source";
import { postRecurringSourcePeriod } from "../actions";

type Config = { name: string; first_period: string; last_period: string; day: number; count: number; mode: "manual" };
type SnapshotLine = { line_id: string; account_id: string; code: string; debit: number; credit: number };
type Snapshot = { entry_id: string; no_jurnal: string; tanggal: string; branch_id: string | null; deskripsi: string | null; lines: SnapshotLine[] };
type Proof = { schedule_id: string; source_entry_id: string; branch_id: string | null; source_snapshot: Snapshot; config: Config; created_at: string };
type Occurrence = { schedule_id: string; period: string; journal_id: string; executed_by: string; executed_at: string; receipt: unknown };
type Schedule = { id: string; nama: string; day_of_month: number; branch_id: string | null; is_active: boolean; max_occurrences: number | null; last_posted: string | null; is_source_schedule: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const amount = (value: number) => `Rp ${Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function JurnalSumberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ page?: string; success?: string; error?: string; posted?: string; replayed?: string; entry?: string }>;
}) {
  const { scheduleId } = await params;
  const query = await searchParams;
  if (!UUID.test(scheduleId)) notFound();
  const supabase = await createClient();
  const [{ data: schedule, error: scheduleError }, { data: proof, error: proofError }] = await Promise.all([
    supabase.from("recurring_journals")
      .select("id,nama,day_of_month,branch_id,is_active,max_occurrences,last_posted,is_source_schedule")
      .eq("id", scheduleId).eq("is_source_schedule", true).maybeSingle(),
    supabase.from("recurring_journal_sources")
      .select("schedule_id,source_entry_id,branch_id,source_snapshot,config,created_at")
      .eq("schedule_id", scheduleId).maybeSingle(),
  ]);
  if (scheduleError || !schedule || !schedule.is_source_schedule) notFound();
  if (proofError || !proof) return <div role="alert" className="p2ban">Rincian jadwal sumber tidak tersedia untuk akun atau cabang ini.</div>;
  const row = schedule as unknown as Schedule;
  const source = proof as unknown as Proof;
  const config = source.config;
  const firstIndex = recurringSourcePeriodIndex(config?.first_period ?? "");
  const lastIndex = recurringSourcePeriodIndex(config?.last_period ?? "");
  if (source.schedule_id !== scheduleId || source.source_entry_id !== source.source_snapshot?.entry_id
    || firstIndex === null || lastIndex === null || !Number.isSafeInteger(config.count) || config.count < 1
    || lastIndex - firstIndex + 1 !== config.count || config.day !== row.day_of_month
    || row.max_occurrences !== config.count || row.branch_id !== source.branch_id || config.mode !== "manual") {
    return <div role="alert" className="p2ban">Konfigurasi atau bukti jadwal tidak konsisten. Minta keuangan meninjau sebelum menjalankan jurnal.</div>;
  }
  const pageCount = Math.max(1, Math.ceil(config.count / 24));
  const requestedPage = Number(query.page ?? 0);
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pageCount - 1, Math.max(0, requestedPage)) : 0;
  const windowPeriods = recurringSourceWindow({ first_period: config.first_period, count: config.count }, [], page);
  const firstVisible = windowPeriods[0]?.period;
  const lastVisible = windowPeriods.at(-1)?.period;
  if (!firstVisible || !lastVisible) return <div role="alert" className="p2ban">Rentang periode jadwal tidak valid.</div>;
  const [{ count: occurrenceCount, error: countError }, { data: oldest, error: oldestError }, { data: latest, error: latestError }, { data: occurrenceRows, count: pageOccurrenceCount, error: occurrenceError }] = await Promise.all([
    supabase.from("recurring_source_occurrences").select("period", { count: "exact", head: true }).eq("schedule_id", scheduleId),
    supabase.from("recurring_source_occurrences").select("period").eq("schedule_id", scheduleId).order("period", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("recurring_source_occurrences").select("schedule_id,period,journal_id,executed_by,executed_at,receipt").eq("schedule_id", scheduleId).order("period", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("recurring_source_occurrences")
      .select("schedule_id,period,journal_id,executed_by,executed_at,receipt", { count: "exact" })
      .eq("schedule_id", scheduleId).gte("period", firstVisible).lte("period", lastVisible)
      .order("period", { ascending: true }).range(0, 23).returns<Occurrence[]>(),
  ]);
  if (countError || oldestError || latestError || occurrenceError || !Array.isArray(occurrenceRows)
    || pageOccurrenceCount !== occurrenceRows.length || !Number.isSafeInteger(occurrenceCount) || (occurrenceCount ?? -1) < 0) {
    return <div role="alert" className="p2ban">Riwayat jadwal belum dapat dimuat dengan lengkap. Coba muat ulang sebelum menjalankan periode.</div>;
  }
  const receiptCount = occurrenceCount as number;
  const lastPosted = row.last_posted?.trim() || null;
  const progress = recurringSourceProgress(config, lastPosted);
  const snapshotLines = Array.isArray(source.source_snapshot?.lines) ? source.source_snapshot.lines : [];
  const snapshotUsable = snapshotLines.length >= 2 && snapshotLines.every((line) =>
    Number.isFinite(Number(line.debit)) && Number.isFinite(Number(line.credit))
    && Number(line.debit) >= 0 && Number(line.credit) >= 0
    && !(Number(line.debit) > 0 && Number(line.credit) > 0))
    && snapshotLines.reduce((sum, line) => sum + Number(line.debit), 0) > 0;
  const latestReceiptValid = receiptCount === 0 ? !latest?.period
    : !!latest && recurringSourceWindow({ first_period: latest.period, count: 1 }, [latest as Occurrence])[0]?.state === "executed";
  const consistent = snapshotUsable && progress !== null && progress === receiptCount
    && (receiptCount === 0
      ? !oldest?.period && !latest?.period
      : oldest?.period === config.first_period && latest?.period === lastPosted && latestReceiptValid);
  const periodRows = consistent
    ? recurringSourceWindow({ first_period: config.first_period, count: config.count }, occurrenceRows as Occurrence[], page)
    : [];
  const pageHasReview = periodRows.some((occurrence) => occurrence.state === "review");
  const sourceAmount = snapshotUsable ? snapshotLines.reduce((sum, line) => sum + Number(line.debit), 0) : null;
  const nextPage = page + 1 < pageCount ? page + 1 : null;
  const previousPage = page > 0 ? page - 1 : null;
  const nextPeriod = consistent && progress !== null && progress < config.count
    ? recurringSourceWindow({ first_period: config.first_period, count: config.count }, [], Math.floor(progress / 24))[progress % 24]?.period ?? null
    : null;
  const due = !!nextPeriod && recurringSourceDue(nextPeriod, config.day, new Date());
  const count = receiptCount;

  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
      <Link href="/keuangan/jurnal-berulang" className="back-btn"><i className="ti ti-arrow-left" /> Jadwal jurnal</Link>
      <span style={{ color: "var(--td)" }}>·</span><span style={{ fontSize: 13, fontWeight: 500 }}>Rincian jadwal</span>
    </div>
    {query.success === "created" && <div className="p2ban" role="status" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>Jadwal tersimpan. Belum ada jurnal periode yang dibuat.</div>}
    {query.posted && <div className="p2ban" role="status" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>Jurnal periode tersimpan. <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(query.posted)}`}>Buka jurnal tepatnya</Link></div>}
    {query.replayed === "1" && <div className="p2ban" role="status" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe" }}>Periode itu sudah pernah diposting; receipt lama dipakai kembali. <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(query.entry ?? "")}`}>Periksa jurnal</Link></div>}
    {query.error && <div className="p2ban" role="alert" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>{query.error}</div>}
    {!consistent && <div className="p2ban" role="alert" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>Penanda progres dan receipt periode tidak cocok. Posting dinonaktifkan sampai keuangan meninjau riwayat ini.</div>}

    <div className="crm-sec">
      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>{config.name}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, fontSize: 12 }}>
        <div><strong>Jurnal sumber:</strong> <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(source.source_entry_id)}`}>{source.source_snapshot.no_jurnal || "Buka jurnal sumber"}</Link></div>
        <div><strong>Tanggal sumber:</strong> {source.source_snapshot.tanggal || "—"}</div>
        <div><strong>Periode:</strong> {config.first_period} — {config.last_period}</div>
        <div><strong>Tanggal posting:</strong> {config.day} setiap bulan</div>
        <div><strong>Mode:</strong> Manual, satu periode tiap tindakan</div>
        <div><strong>Nilai debit:</strong> {sourceAmount === null ? "—" : amount(sourceAmount)}</div>
        <div><strong>Receipt:</strong> {count} / {config.count}</div>
        <div><strong>Terakhir:</strong> {lastPosted ?? "Belum diposting"}</div>
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 450 }}><thead><tr><th>Akun</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Kredit</th></tr></thead>
          <tbody>{snapshotUsable ? snapshotLines.map((line) => <tr key={line.line_id}><td>{line.code}</td><td style={{ textAlign: "right" }}>{amount(Number(line.debit))}</td><td style={{ textAlign: "right" }}>{amount(Number(line.credit))}</td></tr>) : <tr><td colSpan={3}>Snapshot jurnal sumber perlu ditinjau.</td></tr>}</tbody>
        </table>
      </div>
      {row.is_active && consistent && !pageHasReview && nextPeriod && (due
        ? <form action={postRecurringSourcePeriod} style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <input type="hidden" name="schedule_id" value={scheduleId} />
          <input type="hidden" name="period" value={nextPeriod} />
          <SubmitButton className="btn-acc">Buat jurnal periode {nextPeriod}</SubmitButton>
        </form>
        : <p role="status" style={{ color: "var(--td)", fontSize: 12, marginTop: 12 }}>Periode tertua yang belum dibuat: {nextPeriod}. Tanggal {config.day} menurut WIB belum tiba.</p>)}
      {!row.is_active && nextPeriod && <p role="status" style={{ color: "var(--td)", fontSize: 12, marginTop: 12 }}>Jadwal nonaktif. Aktifkan kembali dari daftar untuk menjalankan periode baru.</p>}
      {pageHasReview && <p role="alert" className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 12 }}>Receipt pada halaman ini tidak cocok dengan jurnal. Posting dinonaktifkan sampai keuangan meninjau riwayat.</p>}
      {!nextPeriod && consistent && <p role="status" style={{ color: "var(--tm)", fontSize: 12, marginTop: 12 }}>Semua {config.count} periode sudah memiliki receipt. Jadwal selesai.</p>}
    </div>

    <div className="crm-sec">
      <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Periode virtual {page * 24 + 1}–{Math.min((page + 1) * 24, config.count)} dari {config.count}</h3>
      <p style={{ color: "var(--td)", fontSize: 11 }}>Periode mendatang belum memiliki jurnal. Jurnal hanya muncul setelah tindakan manual berhasil dan receipt tersimpan.</p>
      <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 540 }}>
        <thead><tr><th>Periode</th><th>Status</th><th>Jurnal</th><th>Nilai sumber</th></tr></thead>
        <tbody>{periodRows.map((occurrence) => {
          const receipt = occurrence.journal_id ? (occurrenceRows as Occurrence[]).find((row) => row.period === occurrence.period && row.journal_id === occurrence.journal_id)?.receipt as Record<string, unknown> | undefined : undefined;
          return <tr key={occurrence.period}>
            <td>{occurrence.period}</td>
            <td>{occurrence.state === "executed" ? "Diposting" : occurrence.state === "review" ? "Perlu ditinjau" : row.is_active ? "Menunggu" : "Ditangguhkan"}</td>
            <td>{occurrence.state === "executed" && occurrence.journal_id
              ? <Link href={`/keuangan/jurnal?entry=${encodeURIComponent(occurrence.journal_id)}`}>{String(receipt?.no_jurnal ?? "Buka jurnal")}</Link>
              : "—"}</td>
            <td>{occurrence.state === "executed" && sourceAmount !== null ? amount(sourceAmount) : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <nav aria-label="Halaman periode jadwal" style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
        {previousPage === null ? <span /> : <Link className="back-btn" href={`/keuangan/jurnal-berulang/${scheduleId}?page=${previousPage}`}>Periode lebih awal</Link>}
        {nextPage === null ? <span /> : <Link className="back-btn" href={`/keuangan/jurnal-berulang/${scheduleId}?page=${nextPage}`}>Periode berikutnya</Link>}
      </nav>
    </div>
  </>;
}
