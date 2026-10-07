import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { RecurringForm } from "./RecurringForm";
import { NoDok } from "@/components/NoDok";
import { toggleRecurring } from "./actions";
import { riwayatJurnalRecurring, type JurnalRecurringHistory } from "@/lib/recurring";
import { ListLoadError, readCompleteList } from "@/lib/checked-list";

type Row = {
  id: string;
  nama: string;
  deskripsi: string | null;
  day_of_month: number;
  branch_id: string | null;
  is_active: boolean;
  max_occurrences: number | null;
  last_posted: string | null;
  lines: { code: string; debit: number; credit: number }[];
  branches: { name: string } | null;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function JurnalBerulangPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();

  let loaded;
  try {
    loaded = await Promise.all([
      readCompleteList<Row>((from, to) => supabase.from("recurring_journals")
        .select("id, nama, deskripsi, day_of_month, branch_id, max_occurrences, is_active, last_posted, lines, branches(name)", { count: "exact" })
        .order("created_at", { ascending: false }).order("id").range(from, to).returns<Row[]>(), "Jadwal jurnal berulang"),
      supabase.from("coa_accounts").select("code, name").eq("is_active", true).order("code"),
      supabase.from("branches").select("id, name").order("name"),
      // Preserve legacy histories; new references identify the full schedule UUID.
      readCompleteList<JurnalRecurringHistory & { id: string }>((from, to) => supabase.from("journal_entries")
        .select("id, no_jurnal, tanggal, source_ref, branch_id, journal_lines(debit, credit)", { count: "exact" })
        .eq("source", "recurring")
        .order("tanggal", { ascending: false }).order("id").range(from, to), "Riwayat jurnal berulang"),
    ]);
  } catch (loadError) {
    return <div className="p2ban" role="alert">{loadError instanceof ListLoadError
      ? loadError.message : "Jurnal berulang belum dapat dimuat. Coba muat ulang."}</div>;
  }
  const [rows, { data: accounts }, { data: branches }, jurnalRows] = loaded;

  const { riwayat, bermasalah, perluDitinjau } = riwayatJurnalRecurring(
    jurnalRows, rows.map((row) => row.id), rows,
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Transaksi Berulang</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {bermasalah > 0 && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-alert-triangle" /> Riwayat jurnal berulang perlu ditinjau: {bermasalah} entri tidak lengkap atau memiliki identitas lama yang ambigu. Minta keuangan memeriksa jurnalnya.
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="DAFTAR TRANSAKSI BERULANG"
          desc="Otomatis diposting tiap bulan (catch-up saat halaman Jurnal Umum dibuka)."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Cabang</th>
                <th style={{ textAlign: "center" }}>Tgl</th>
                <th style={{ textAlign: "right" }}>Nilai</th>
                <th style={{ width: 200 }}>Sudah berjalan</th>
                <th>Terakhir Posting</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const nilai = (r.lines ?? []).reduce((a, l) => a + (Number(l.debit) || 0), 0);
                const jalan = (riwayat.get(r.id) ?? [])
                  .sort((a, b) => b.periode.localeCompare(a.periode));
                const review = perluDitinjau.has(r.id);
                const selesai = !review && r.max_occurrences !== null && jalan.length >= r.max_occurrences;
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {r.nama}
                      {r.deskripsi && <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{r.deskripsi}</div>}
                    </td>
                    <td style={{ fontSize: 11 }}>{r.branches?.name ?? "Pusat"}</td>
                    <td style={{ textAlign: "center", fontSize: 11.5 }}>{r.day_of_month}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(nilai)}</td>
                    {/* Rincian tiap kali jalan — sampai nomor jurnalnya, dan nomor itu
                        bisa diklik ke jurnalnya (permintaan Bu Nisa 14 Agustus). */}
                    <td style={{ fontSize: 11 }}>
                      <div style={{ marginBottom: 4, color: "var(--tm)" }}>
                        {jalan.length} / {r.max_occurrences ?? "tanpa batas"} kali
                      </div>
                      {jalan.length === 0 ? (
                        <span style={{ color: "var(--td)" }}>Belum pernah jalan</span>
                      ) : (
                        <details>
                          <summary style={{ cursor: "pointer", listStyle: "none", fontWeight: 600 }}>
                            <i className="ti ti-chevron-right" style={{ fontSize: 11, verticalAlign: "-1px" }} />
                            {jalan.length}x · total {rp(jalan.reduce((a, j) => a + j.nilai, 0))}
                          </summary>
                          <div style={{ marginTop: 5 }}>
                            {jalan.map((j) => (
                              <div key={j.no_jurnal} style={{
                                display: "flex", justifyContent: "space-between", gap: 8,
                                fontSize: 10, padding: "2px 0", whiteSpace: "nowrap",
                              }}>
                                <span style={{ color: "var(--tm)" }}>{j.periode}</span>
                                <NoDok nomor={j.no_jurnal} style={{ fontFamily: "monospace" }} />
                                <span style={{ color: "var(--td)" }}>{rp(j.nilai)}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.last_posted ?? "Belum pernah"}</td>
                    <td><span className={`bge ${r.is_active ? "g" : "x"}`}>{review ? "Perlu ditinjau" : selesai ? "Selesai" : r.is_active ? "Aktif" : "Nonaktif"}</span></td>
                    <td>
                      {!selesai && <form action={toggleRecurring}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="aktif" value={r.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                          {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada jurnal berulang.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RecurringForm key={user?.id} userId={user?.id ?? ""} accounts={accounts ?? []} branches={branches ?? []} />
    </>
  );
}
