import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { TabelKosong } from "@/components/LaporanPage";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { readListPage } from "@/lib/checked-list";
import {
  CORRECTION_QUEUE_PATH, CORRECTION_REQUEST_SELECT, sourceHref, sourceKindLabel, statusLabel,
  type CorrectionStatus, type PurchaseCorrectionRequest,
} from "@/lib/purchase-correction-requests";
import { prosesKoreksiPembelian } from "./actions";

// A02/P01 — antrean permintaan koreksi pembelian. Super Admin melihat semua request
// di cabang yang boleh ia buka; peran lain hanya melihat request miliknya (RLS).
// Memproses request hanya mencatat tindak lanjut; koreksi resmi tetap di dokumen asal.

const waktu = (iso: string) => new Date(iso).toLocaleString("id-ID", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
});

export default async function PurchaseCorrectionQueuePage({ searchParams }: {
  searchParams: Promise<{ status?: string; hal?: string; error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const status: CorrectionStatus = sp.status === "selesai" ? "selesai" : "pending";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle();
  if (!user || !me) redirect("/login");
  const owner = me.role === "OWNER" && me.is_active;

  let page;
  let loadError: unknown;
  try {
    page = await readListPage<PurchaseCorrectionRequest>((from, to) => supabase.from("purchase_correction_requests")
      .select(CORRECTION_REQUEST_SELECT, { count: "exact" }).eq("status", status)
      .order("created_at", { ascending: status === "pending" }).order("id").range(from, to), "Permintaan koreksi pembelian", sp.hal);
  } catch (error) { loadError = error; }
  const rows = page?.rows ?? [];
  const people = [...new Set(rows.flatMap(row => [row.requested_by, row.processed_by]).filter((id): id is string => !!id))];
  const { data: profiles } = people.length
    ? await supabase.from("profiles").select("id,full_name").in("id", people)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nama = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name || "(tanpa nama)"]));
  const who = (id: string | null) => id ? nama.get(id) ?? "(nama tidak dapat dimuat)" : "—";

  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href="/pembelian" className="back-btn"><i className="ti ti-arrow-left" /> Pembelian</Link>
      <span style={{ color: "var(--td)" }}>·</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{owner ? "Permintaan koreksi pembelian" : "Permintaan koreksi saya"}</span>
    </div>
    {sp.error && <div role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>{sp.error}</div>}
    {sp.success && <div role="status" className="p2ban" style={{ background: "#e8f5ee", color: "#15803d" }}>{sp.success}</div>}

    <nav aria-label="Status permintaan" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
      <Link href={CORRECTION_QUEUE_PATH} className={status === "pending" ? "btn-acc" : "btn-def"}>Menunggu</Link>
      <Link href={`${CORRECTION_QUEUE_PATH}?status=selesai`} className={status === "selesai" ? "btn-acc" : "btn-def"}>Sudah diproses</Link>
    </nav>

    <section className="crm-sec">
      <SecHeader num="01" title={`${status === "pending" ? "MENUNGGU SUPER ADMIN" : "SUDAH DIPROSES"} (${page?.count ?? "—"})`}
        desc={owner ? "Periksa dokumen asal, lakukan koreksi resmi bila perlu, lalu catat tindak lanjutnya di sini."
          : "Permintaan yang Anda kirim dan statusnya. Super Admin yang memutuskan dan melakukan koreksi resmi."} />
      {loadError !== undefined && <ListLoadFailure error={loadError} label="Permintaan koreksi pembelian" />}
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 860 }}>
          <thead><tr><th style={{ width: 170 }}>Dokumen asal</th><th>Rincian</th><th style={{ width: 150 }}>Diminta</th><th style={{ width: 280 }}>Status</th></tr></thead>
          <tbody>
            {rows.map(row => {
              const href = sourceHref(row);
              return <tr key={row.id} id={`request-${row.id}`}>
                <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                  {sourceKindLabel(row.source_kind)}{" "}
                  {href ? <Link href={`${href}#request-purchase-correction`}>{row.source_label}</Link> : <>{row.source_label} (tautan asal tidak lengkap)</>}
                </td>
                <td style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{row.detail}</td>
                <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{who(row.requested_by)}<br />{waktu(row.created_at)}</td>
                <td style={{ fontSize: 11 }}>
                  <strong>{statusLabel(row.status)}</strong>
                  {row.status === "selesai" && <div style={{ fontSize: 10.5 }}>
                    {who(row.processed_by)} · {row.processed_at ? waktu(row.processed_at) : "—"}
                    <div style={{ whiteSpace: "pre-wrap" }}>{row.resolution}</div>
                  </div>}
                  {owner && row.status === "pending" && <form action={prosesKoreksiPembelian} style={{ display: "grid", gap: 6, marginTop: 6 }}>
                    <input type="hidden" name="id" value={row.id} />
                    <textarea className="fi" name="resolution" required minLength={3} maxLength={1000} rows={2}
                      aria-label={`Tindak lanjut ${row.source_label}`} placeholder="Tindak lanjut, mis. faktur dibatalkan & diganti FB-..., atau alasan tidak perlu koreksi" />
                    <button type="submit" className="btn-acc" style={{ fontSize: 10.5, justifySelf: "start" }}>Tandai sudah diproses</button>
                  </form>}
                </td>
              </tr>;
            })}
            {page && rows.length === 0 && <TabelKosong kolom={4} pesan={status === "pending" ? "Tidak ada permintaan koreksi yang menunggu." : "Belum ada permintaan yang diproses."} />}
          </tbody>
        </table>
      </div>
      {page && <ListPagination path={CORRECTION_QUEUE_PATH} query={status === "selesai" ? { status } : {}} total={page.count} pageInfo={page.pageInfo} />}
      <p style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.7 }}>
        Permintaan ini tidak mengubah PO, faktur, pembayaran, stok, atau jurnal. Menandai &quot;sudah diproses&quot;
        hanya mencatat tindak lanjut; koreksi resmi tetap dilakukan Super Admin di dokumen asal.
      </p>
    </section>
  </>;
}
