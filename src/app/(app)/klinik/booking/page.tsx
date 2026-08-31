import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { composeBookingScheduledAt, LABEL_STATUS_BOOKING, BADGE_STATUS_BOOKING } from "@/lib/booking";
import { konfirmasiBooking, tolakBooking, batalkanBooking } from "./actions";
import { NoShowButton } from "./NoShowButton";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const TAB = ["baru", "dikonfirmasi", "selesai", "ditolak"] as const;
const JUDUL_TAB: Record<string, string> = {
  baru: "Belum dijawab",
  dikonfirmasi: "Sudah dikonfirmasi",
  selesai: "Sudah datang",
  ditolak: "Ditolak / batal",
};

export default async function BookingKlinikPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string; success?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TAB as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "baru";
  const supabase = await createClient();

  const { data } = await supabase
    .from("bookings")
    .select("id, tanggal, jam, poli, nama_pemilik, phone, nama_hewan, jenis_hewan, keluhan, status, attendance_outcome, catatan_staf, visit_id, created_at, branches(name)")
    .order("tanggal").order("jam");

  type Row = {
    id: string; tanggal: string; jam: string; poli: string; nama_pemilik: string; phone: string;
    nama_hewan: string; jenis_hewan: string; keluhan: string | null; status: string;
    attendance_outcome: string; catatan_staf: string | null; visit_id: string | null; created_at: string;
    branches: Rel<{ name: string }>;
  };
  const semua = (data ?? []) as Row[];
  const nowMs = new Date().getTime();

  const cocok = (r: Row) =>
    tab === "selesai" ? !!r.visit_id
      : tab === "ditolak" ? r.status === "ditolak" || r.status === "batal"
      : tab === "dikonfirmasi" ? r.status === "dikonfirmasi" && !r.visit_id
      : r.status === "baru";
  const baris = semua.filter(cocok);

  const jumlah = {
    baru: semua.filter((r) => r.status === "baru").length,
    dikonfirmasi: semua.filter((r) => r.status === "dikonfirmasi" && !r.visit_id).length,
    selesai: semua.filter((r) => !!r.visit_id).length,
    ditolak: semua.filter((r) => r.status === "ditolak" || r.status === "batal").length,
  } as Record<string, number>;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Booking Online</span>
      </div>

      {sp.error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {sp.error}
        </div>
      )}
      {sp.success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Booking ditandai {LABEL_STATUS_BOOKING[sp.success]?.toLowerCase() ?? sp.success}.
          Kabari pemiliknya lewat WhatsApp.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 11, flexWrap: "wrap" }}>
        {TAB.map((t) => (
          <Link key={t} href={`/klinik/booking?tab=${t}`} className="back-btn"
            style={t === tab ? { background: "#eff6ff", color: "var(--posb)", borderColor: "#bfdbfe", fontWeight: 700 } : {}}>
            {JUDUL_TAB[t]} ({jumlah[t] ?? 0})
          </Link>
        ))}
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01" title="PESANAN JADWAL DARI PELANGGAN"
          desc="Datang dari halaman booking publik. Booking bukan antrian — kunjungan baru lahir saat pasiennya didaftarkan."
        />

        {baris.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--td)" }}>Tidak ada booking di kelompok ini.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {baris.map((b) => {
              const lewat = new Date(composeBookingScheduledAt(b.tanggal, b.jam)).getTime() < nowMs && !b.visit_id;
              return (
                <div key={b.id} className="card" style={{ borderColor: lewat ? "#fecaca" : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {b.nama_hewan} <span style={{ fontSize: 11, fontWeight: 400, color: "var(--tm)" }}>· {b.jenis_hewan}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--tm)" }}>
                        {b.nama_pemilik} · {b.phone}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {new Date(`${b.tanggal}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "2-digit", month: "short" })} · {b.jam} WIB
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--td)" }}>
                        {one(b.branches)?.name ?? "—"} · {b.poli}
                      </div>
                    </div>
                  </div>

                  {b.keluhan && (
                    <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 7, paddingTop: 7, borderTop: ".5px dashed var(--bd)" }}>
                      <i className="ti ti-message" /> {b.keluhan}
                    </div>
                  )}
                  {b.catatan_staf && (
                    <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 5 }}>
                      Catatan staf: {b.catatan_staf}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 9 }}>
                    <span className={`bge ${BADGE_STATUS_BOOKING[b.status] ?? ""}`}>
                      {b.visit_id ? "Sudah didaftarkan" : b.attendance_outcome === "no_show" ? "Tidak hadir" : LABEL_STATUS_BOOKING[b.status] ?? b.status}
                    </span>
                    {lewat && <span className="bge r">Tanggalnya sudah lewat</span>}

                    {!b.visit_id && (
                      <>
                        <Link href={`/klinik/registrasi?booking=${b.id}`} className="btn-acc"
                          style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
                          <i className="ti ti-user-plus" /> Daftarkan sekarang
                        </Link>
                        {b.status === "baru" && (
                          <form action={konfirmasiBooking} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                            <input type="hidden" name="id" value={b.id} />
                            <SubmitButton className="btn-def" style={{ padding: "4px 10px", fontSize: 11 }} pendingText="...">
                              <i className="ti ti-check" /> Konfirmasi
                            </SubmitButton>
                          </form>
                        )}
                        <form action={b.status === "baru" ? tolakBooking : batalkanBooking}
                          style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <input type="hidden" name="id" value={b.id} />
                          <input className="fi" name="catatan" placeholder="alasan (opsional)"
                            style={{ width: 160, height: 26, fontSize: 10.5 }} />
                          <SubmitButton className="btn-def" style={{ padding: "4px 10px", fontSize: 11 }} pendingText="...">
                            <i className="ti ti-x" /> {b.status === "baru" ? "Tolak" : "Batalkan"}
                          </SubmitButton>
                        </form>
                        {b.status === "dikonfirmasi" && b.attendance_outcome === "pending" && lewat && <NoShowButton id={b.id} />}
                      </>
                    )}
                    {b.visit_id && (
                      <Link href={`/klinik/rekam-medis/${b.visit_id}`} className="btn-def"
                        style={{ padding: "4px 10px", fontSize: 11, textDecoration: "none" }}>
                        Lihat kunjungannya
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--td)" }}>
          Alamat formulir untuk pelanggan: <b>/booking</b> — bisa ditempel di bio Instagram, WhatsApp, atau Google Maps.
        </div>
      </div>
    </>
  );
}
