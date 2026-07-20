import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONDITION_LABEL, type Condition } from "@/lib/inpatient";
import { LogEditForm, type EditRow, type LogRow } from "./LogEditForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Detail satu catatan harian rawat inap — layout mengikuti form Tambah supaya
// dokter tidak perlu belajar dua tampilan. Panel POS sengaja tidak ada: obat yang
// terlanjur diinput sudah masuk tagihan & memotong stok, jadi tidak bisa dikoreksi
// dari sini (lihat addDailyLogPos).
export default async function LogDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string; logId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, logId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: rec }, { data: log }] = await Promise.all([
    supabase
      .from("inpatient_records")
      .select("id, condition_status, doctor_name, admitted_at, discharged_at, visit_id, visits(created_at, pets(name, species, breed, photo_url), customers(name, phone, address))")
      .eq("id", id).maybeSingle(),
    supabase
      .from("inpatient_daily_logs")
      .select("id, log_date, created_at, condition_note, tindakan, keterangan, doctor_name, inpatient_record_id")
      .eq("id", logId).maybeSingle(),
  ]);
  if (!rec || !log || log.inpatient_record_id !== id) notFound();

  const { data: editRows } = await supabase
    .from("inpatient_daily_log_edits")
    .select("edited_at, alasan, before, profiles(full_name)")
    .eq("log_id", logId)
    .order("edited_at", { ascending: false });

  const edits: EditRow[] = (editRows ?? []).map((e) => ({
    edited_at: e.edited_at as string,
    alasan: (e.alasan as string | null) ?? null,
    oleh: one(e.profiles as Rel<{ full_name: string | null }>)?.full_name ?? "—",
    before: (e.before ?? {}) as EditRow["before"],
  }));

  const visit = one(rec.visits as Rel<{ created_at: string; pets: Rel<{ name: string; species: string | null; breed: string | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);

  const noRM = visit
    ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(rec.visit_id as string).slice(0, 3).toUpperCase()}`
    : "—";
  const tglMasuk = new Date(rec.admitted_at as string).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={`/klinik/rawat-inap/${id}`} className="back-btn"><i className="ti ti-arrow-left" /> Laporan Rawat Inap</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-clipboard-text" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>DETAIL CATATAN HARIAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            {new Date(log.created_at as string).toLocaleString("id-ID", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <LogEditForm
        log={log as unknown as LogRow}
        recordId={id}
        backHref={`/klinik/rawat-inap/${id}`}
        editable={!rec.discharged_at}
        edits={edits}
        patient={{
          name: pet?.name ?? "—",
          species: pet?.species ?? "—",
          breed: pet?.breed ?? null,
          noRM,
          owner: cust?.name ?? "—",
          phone: cust?.phone ?? "—",
          address: cust?.address ?? "—",
          tglMasuk,
          dokter: rec.doctor_name ?? "",
          kondisi: CONDITION_LABEL[rec.condition_status as Condition] ?? String(rec.condition_status),
          photo: pet?.photo_url ?? null,
        }}
      />
    </>
  );
}
