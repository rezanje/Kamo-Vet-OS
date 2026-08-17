import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { RecurringForm } from "./RecurringForm";
import { NoDok } from "@/components/NoDok";
import { toggleRecurring } from "./actions";

type Row = {
  id: string;
  nama: string;
  deskripsi: string | null;
  day_of_month: number;
  is_active: boolean;
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

  const [{ data: rjs }, { data: accounts }, { data: branches }, { data: jurnalRows }] = await Promise.all([
    supabase.from("recurring_journals").select("id, nama, deskripsi, day_of_month, is_active, last_posted, lines, branches(name)").order("created_at", { ascending: false }),
    supabase.from("coa_accounts").select("code, name").eq("is_active", true).order("code"),
    supabase.from("branches").select("id, name").order("name"),
    // Riwayat jalannya: tiap posting menulis jurnal ber-source "recurring" dengan
    // ref "<8 huruf pertama id>-<YYYY-MM>" (lib/recurring.ts). Dari situ jumlah
    // berjalan dan nomor jurnal tiap bulan bisa ditarik tanpa tabel baru.
    supabase.from("journal_entries")
      .select("no_jurnal, tanggal, source_ref, journal_lines(debit)")
      .eq("source", "recurring")
      .order("tanggal", { ascending: false }),
  ]);
  const rows = (rjs ?? []) as unknown as Row[];

  type JurnalRow = { no_jurnal: string; tanggal: string; source_ref: string | null; journal_lines: { debit: number }[] };
  const riwayat = new Map<string, { no_jurnal: string; tanggal: string; periode: string; nilai: number }[]>();
  for (const j of (jurnalRows ?? []) as unknown as JurnalRow[]) {
    const ref = j.source_ref ?? "";
    const pisah = ref.lastIndexOf("-", ref.length - 4);   // "<id8>-YYYY-MM"
    if (pisah <= 0) continue;
    const kunci = ref.slice(0, ref.indexOf("-"));
    const periode = ref.slice(ref.indexOf("-") + 1);
    const nilai = (j.journal_lines ?? []).reduce((a, l) => a + (Number(l.debit) || 0), 0);
    const arr = riwayat.get(kunci) ?? [];
    arr.push({ no_jurnal: j.no_jurnal, tanggal: j.tanggal, periode, nilai });
    riwayat.set(kunci, arr);
  }

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
                const jalan = (riwayat.get(r.id.slice(0, 8)) ?? [])
                  .sort((a, b) => b.periode.localeCompare(a.periode));
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
                    <td><span className={`bge ${r.is_active ? "g" : "x"}`}>{r.is_active ? "Aktif" : "Nonaktif"}</span></td>
                    <td>
                      <form action={toggleRecurring}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="aktif" value={r.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                          {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
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

      <RecurringForm accounts={accounts ?? []} branches={branches ?? []} />
    </>
  );
}
