import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { batasPerluDiingatkan, bacaHariIngat, PILIHAN_HARI_INGAT, pesanReminder, posisiFollowUp, tanggalIndo, waLink } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";
import { tandaiFollowUp } from "./actions";
import { WaButton } from "./WaButton";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Row = {
  id: string; jenis: string; tanggal: string; catatan: string | null; status: string;
  pets: Rel<{ name: string }>;
  customers: Rel<{ name: string; phone: string | null }>;
  branches: Rel<{ name: string }>;
  /** Dokter pada kunjungan yang melahirkan follow up ini. */
  visits: Rel<{ dokter: string | null }>;
};

const TABS = [
  ["perlu", "Perlu diingatkan", "ti-bell-ringing"],
  ["mendatang", "Mendatang", "ti-calendar"],
  ["riwayat", "Riwayat", "ti-history"],
] as const;

// Worklist reminder pelanggan. Sumbernya tabel follow_ups yang diisi dokter di rekam medis.
export default async function FollowUpPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; h?: string; error?: string; success?: string }>;
}) {
  const { tab: tabParam, h, error, success } = await searchParams;
  // "jatuh-tempo" = nama tab lama; tautan yang sudah tersimpan tetap membuka daftar yang sama.
  const tab = tabParam === "mendatang" || tabParam === "riwayat" ? tabParam : "perlu";
  const hariIngat = bacaHariIngat(h);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = hariIniWIB();
  const batas = batasPerluDiingatkan(today, hariIngat);
  const tabHref = (id: string, hari = hariIngat) => `/klinik/follow-up?tab=${id}&h=${hari}`;
  let q = supabase
    .from("follow_ups")
    .select("id, jenis, tanggal, catatan, status, pets(name), customers(name, phone), branches(name), visits(dokter)");

  if (tab === "riwayat") q = q.neq("status", "Menunggu").order("tanggal", { ascending: false });
  else if (tab === "mendatang") q = q.eq("status", "Menunggu").gt("tanggal", batas).order("tanggal");
  else q = q.eq("status", "Menunggu").lte("tanggal", batas).order("tanggal");

  const { data } = await q.limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#fffbeb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-calendar-event" style={{ fontSize: 22, color: "#d97706" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>FOLLOW UP</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Reminder kontrol, vaksin & grooming untuk pelanggan</div>
        </div>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Status follow up diperbarui.</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {TABS.map(([id, label, icon]) => (
          <Link key={id} href={tabHref(id)} className="back-btn" style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, textDecoration: "none",
            border: ".5px solid var(--bd)", background: tab === id ? "var(--posb)" : "#fff", color: tab === id ? "#fff" : "var(--tm)",
          }}><i className={`ti ${icon}`} /> {label}</Link>
        ))}
      </div>

      {tab !== "riwayat" && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 11, color: "var(--tm)" }}>
          <span>Ingatkan pelanggan</span>
          {PILIHAN_HARI_INGAT.map((hari) => (
            <Link key={hari} href={tabHref(tab, hari)} aria-current={hari === hariIngat ? "true" : undefined} style={{
              padding: "3px 9px", borderRadius: 7, fontSize: 10.5, fontWeight: 600, textDecoration: "none",
              border: ".5px solid var(--bd)", background: hari === hariIngat ? "#d97706" : "#fff", color: hari === hariIngat ? "#fff" : "var(--tm)",
            }}>{hari === 0 ? "di hari-H" : `H-${hari}`}</Link>
          ))}
          <span>
            {tab === "perlu"
              ? `· menampilkan jadwal sampai ${tanggalIndo(batas)} yang belum dikirimi WhatsApp.`
              : `· jadwal setelah ${tanggalIndo(batas)}; otomatis pindah ke "Perlu diingatkan" saat masuk H-${hariIngat}.`}
          </span>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Tanggal</th><th style={{ width: 100 }}>Jenis</th>
                <th>Pasien</th><th>Pemilik</th><th style={{ width: 130 }}>Dokter sebelumnya</th><th>Catatan</th>
                <th style={{ width: 210 }}>{tab === "riwayat" ? "Status" : "Aksi"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pet = one(r.pets), cust = one(r.customers), br = one(r.branches);
                const posisi = posisiFollowUp(r.tanggal, today);
                const pesan = pesanReminder({
                  pemilik: cust?.name ?? "Kak", hewan: pet?.name ?? "anabul",
                  jenis: r.jenis, tanggal: r.tanggal, catatan: r.catatan, klinik: br?.name,
                });
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5, color: posisi.telat && tab !== "riwayat" ? "#b91c1c" : "var(--tx)", fontWeight: posisi.telat && tab !== "riwayat" ? 700 : 400 }}>
                      {tanggalIndo(r.tanggal)}{tab !== "riwayat" && <div style={{ fontSize: 9, color: posisi.telat ? "#b91c1c" : "#d97706" }}>{posisi.teks}</div>}
                    </td>
                    <td><span className="bge b">{r.jenis}</span></td>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{pet?.name ?? "—"}</td>
                    <td style={{ fontSize: 10.5 }}>
                      {cust?.name ?? "—"}
                      <div style={{ fontSize: 9, color: "var(--tm)" }}>{cust?.phone || "tanpa no. HP"}</div>
                    </td>
                    {/* Dokter yang menangani kunjungan sebelumnya (masukan drh. Ilham, 25 Agu):
                        menentukan kasusnya cukup dikonsulkan ke dokter yang sama atau perlu
                        diperiksa ulang dari awal oleh dokter lain. */}
                    <td style={{ fontSize: 10.5, color: one(r.visits)?.dokter ? "var(--tx)" : "var(--td)" }}>
                      {one(r.visits)?.dokter || "—"}
                    </td>
                    <td style={{ fontSize: 10.5, color: r.catatan ? "var(--tx)" : "var(--td)", maxWidth: 220 }}>{r.catatan || "—"}</td>
                    <td>
                      {tab === "riwayat" ? (
                        <span className={`bge ${r.status === "Selesai" ? "g" : r.status === "Batal" ? "x" : "b"}`}>{r.status}</span>
                      ) : (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {cust?.phone && (
                            <form action={tandaiFollowUp}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="tab" value={tab} /><input type="hidden" name="h" value={hariIngat} />
                              <input type="hidden" name="status" value="Terkirim" />
                              <WaButton href={waLink(cust.phone, pesan)} />
                            </form>
                          )}
                          <form action={tandaiFollowUp}>
                            <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="tab" value={tab} /><input type="hidden" name="h" value={hariIngat} />
                            <input type="hidden" name="status" value="Selesai" />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">Selesai</SubmitButton>
                          </form>
                          <form action={tandaiFollowUp}>
                            <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="tab" value={tab} /><input type="hidden" name="h" value={hariIngat} />
                            <input type="hidden" name="status" value="Batal" />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">Batal</SubmitButton>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  {tab === "perlu" ? "Tidak ada pelanggan yang perlu diingatkan. Aman." : "Belum ada data."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
