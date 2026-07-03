import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateVisitStatus } from "./actions";
import { CancelButton } from "./CancelButton";
import { SecHeader } from "@/components/SecHeader";
import { LiveRefresh } from "./LiveRefresh";
import { estimatedWaitMinutes } from "@/lib/queue";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const STATUS_BADGE: Record<string, string> = { Menunggu: "o", Diperiksa: "b", Pembayaran: "r", Selesai: "g" };

export default async function AntrianPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; success?: string }>;
}) {
  const { filter = "aktif", success } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("visits")
    .select("id, poli, dokter, status, created_at, keluhan, queue_number, called_at, pets(name, species), customers(name, phone), branches(code)")
    .order("created_at", { ascending: true });

  if (filter === "aktif") query = query.neq("status", "Selesai");
  if (filter === "menunggu") query = query.eq("status", "Menunggu");
  if (filter === "diperiksa") query = query.eq("status", "Diperiksa");
  if (filter === "selesai") query = query.eq("status", "Selesai");

  const { data: visits } = await query;

  // Panel "Panggilan Berikutnya" + Informasi Poli (§4): selalu dari seluruh antrian Menunggu.
  const { data: allWaiting } = await supabase
    .from("visits")
    .select("id, poli, queue_number, pets(name, species), customers(name)")
    .eq("status", "Menunggu")
    .order("created_at", { ascending: true });
  const nextUp = (allWaiting ?? [])[0];

  const poliCounts = new Map<string, number>();
  for (const v of allWaiting ?? []) poliCounts.set(v.poli, (poliCounts.get(v.poli) ?? 0) + 1);
  // posisi antrian per visit id utk estimasi tunggu (posisi × 20 menit, v1 sederhana).
  const waitPos = new Map<string, number>();
  (allWaiting ?? []).forEach((v, i) => waitPos.set(v.id as string, i));

  // Counter hari ini (§3.3) — query terpisah, tidak terpengaruh filter tabel.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: today } = await supabase
    .from("visits")
    .select("status")
    .gte("created_at", startOfDay.toISOString());
  const counts = { Menunggu: 0, Diperiksa: 0, Pembayaran: 0, Selesai: 0 };
  for (const v of today ?? []) {
    if (v.status in counts) counts[v.status as keyof typeof counts]++;
  }
  const totalToday = today?.length ?? 0;

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <LiveRefresh />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Antrian Pasien</span>
        <span style={{ fontSize: 9.5, color: "var(--td)", marginLeft: 6 }}>
          <i className="ti ti-broadcast" style={{ color: "#16a34a" }} /> live — update otomatis via realtime
        </span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" />{" "}
          {success === "bayar"
            ? "Pembayaran selesai, kunjungan ditutup."
            : "Pasien berhasil didaftarkan, masuk antrian."}
        </div>
      )}

      {/* Counter hari ini (§3.3) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 14 }}>
        {([
          { label: "Menunggu", val: counts.Menunggu, color: "#b55a35", bg: "#fdf0ea", icon: "ti-clock" },
          { label: "Diperiksa", val: counts.Diperiksa, color: "#1d4ed8", bg: "#eff6ff", icon: "ti-stethoscope" },
          { label: "Pembayaran", val: counts.Pembayaran, color: "#b91c1c", bg: "#fef2f2", icon: "ti-cash" },
          { label: "Selesai", val: counts.Selesai, color: "#15803d", bg: "#e8f5ee", icon: "ti-circle-check" },
          { label: "Total hari ini", val: totalToday, color: "#141413", bg: "#f7f5f1", icon: "ti-users" },
        ] as const).map((c) => (
          <div key={c.label} className="card" style={{ padding: "11px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i className={`ti ${c.icon}`} style={{ color: c.color, fontSize: 15 }} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#141413", lineHeight: 1 }}>{c.val}</div>
                <div style={{ fontSize: 9.5, color: "var(--tm)", marginTop: 2 }}>{c.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Panel Panggilan Berikutnya + Informasi Poli (§4) */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, borderColor: "var(--sb)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--sb)", letterSpacing: ".05em", marginBottom: 4 }}>
              <i className="ti ti-bell-ringing" /> PANGGILAN BERIKUTNYA
            </div>
            {nextUp ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: "var(--sb)", fontFamily: "ui-monospace, monospace" }}>
                  {nextUp.queue_number ?? "—"}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{one(nextUp.pets)?.name ?? "—"} <span style={{ fontWeight: 400, color: "var(--tm)", fontSize: 11 }}>· {one(nextUp.pets)?.species}</span></div>
                  <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{one(nextUp.customers)?.name ?? "—"} · {nextUp.poli}</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--td)" }}>Tidak ada antrian menunggu.</div>
            )}
          </div>
          {nextUp && (
            <form action={updateVisitStatus}>
              <input type="hidden" name="id" value={nextUp.id} />
              <input type="hidden" name="status" value="Diperiksa" />
              <button type="submit" className="pay-btn" style={{ padding: "13px 26px", fontSize: 14 }}>
                <i className="ti ti-bell" /> Panggil Sekarang
              </button>
            </form>
          )}
        </div>
        <div className="card">
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--sb)", letterSpacing: ".05em", marginBottom: 6 }}>
            <i className="ti ti-building-hospital" /> INFORMASI POLI (MENUNGGU)
          </div>
          {poliCounts.size === 0 ? (
            <div style={{ fontSize: 11, color: "var(--td)" }}>Semua poli kosong.</div>
          ) : (
            [...poliCounts.entries()].map(([poli, n]) => (
              <div key={poli} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}>
                <span style={{ color: "var(--tm)" }}>{poli}</span>
                <span style={{ fontWeight: 700 }}>{n} <span style={{ fontWeight: 400, color: "var(--td)", fontSize: 10 }}>menunggu</span></span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="ANTRIAN PASIEN" desc="Daftar pasien & status pemeriksaan hari ini."
          action={<Link href="/klinik/registrasi" className="btn-acc" style={{ textDecoration: "none" }}>+ Daftarkan pasien</Link>} />

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {[
            { key: "semua", label: "Semua Antrian" },
            { key: "menunggu", label: "Menunggu" },
            { key: "diperiksa", label: "Sedang Diperiksa" },
            { key: "selesai", label: "Selesai" },
            { key: "aktif", label: "Aktif" },
          ].map((t) => (
            <Link key={t.key} href={`/klinik/antrian?filter=${t.key}`}
              className="back-btn"
              style={{
                padding: "5px 12px", borderRadius: 7, border: ".5px solid var(--bd)",
                background: filter === t.key ? "var(--sb)" : "#fff",
                color: filter === t.key ? "#fff" : "var(--tm)",
              }}>
              {t.label}
            </Link>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>No</th><th>Jam</th><th>Pasien</th><th>Pemilik</th><th>Cabang</th>
                <th>Poli / Keluhan</th><th>Estimasi</th><th>Status</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(visits ?? []).map((v) => {
                const pet = one(v.pets);
                const cust = one(v.customers);
                const branch = one(v.branches);
                const pos = waitPos.get(v.id);
                return (
                  <tr key={v.id}>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--sb)" }}>{v.queue_number ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtTime(v.created_at)}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{pet?.name ?? "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--tm)" }}>{pet?.species}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 11.5 }}>{cust?.name ?? "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--tm)" }}>{cust?.phone}</div>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{branch?.code ?? "—"}</td>
                    <td>
                      <div style={{ fontSize: 11.5 }}>{v.poli}</div>
                      {v.keluhan && <div style={{ fontSize: 10, color: "var(--tm)" }}>{v.keluhan}</div>}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {v.status === "Menunggu" && pos !== undefined ? `± ${estimatedWaitMinutes(pos)} mnt` : "—"}
                    </td>
                    <td><span className={`bge ${STATUS_BADGE[v.status]}`}>{v.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        {v.status === "Menunggu" && (
                          <>
                            <form action={updateVisitStatus}>
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="status" value="Diperiksa" />
                              <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>Panggil</button>
                            </form>
                            <CancelButton id={v.id} />
                          </>
                        )}
                        {v.status === "Diperiksa" && (
                          <Link href={`/klinik/rekam-medis/${v.id}`} className="btn-acc"
                            style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                            <i className="ti ti-stethoscope" /> Rekam medis
                          </Link>
                        )}
                        {v.status === "Pembayaran" && (
                          <Link href={`/klinik/pembayaran/${v.id}`} className="btn-acc"
                            style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                            <i className="ti ti-cash" /> Bayar
                          </Link>
                        )}
                        {v.status === "Selesai" && (
                          <>
                            <Link href={`/klinik/rekam-medis/${v.id}`} className="btn-def"
                              style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <i className="ti ti-eye" /> Lihat
                            </Link>
                            <Link href={`/klinik/pembayaran/${v.id}`} className="btn-def"
                              style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <i className="ti ti-file-invoice" /> Tagihan
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(visits ?? []).length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Tidak ada pasien di antrian.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
