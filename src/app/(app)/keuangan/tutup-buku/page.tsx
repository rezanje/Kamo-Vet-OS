import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";
import { buildClosingLines } from "@/lib/tutup-buku";
import { jalankanAkhirBulanSekarang, setKunci, simpanAturanAkhirBulan, tutupBuku } from "./actions";
import { periodeSelesai, tanggalTerakhir } from "@/lib/akhir-bulan";
import { labelBulan } from "@/lib/pertumbuhan";
import { hariIniWIB } from "@/lib/tanggal";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

export default async function TutupBukuPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const today = hariIniWIB();
  const [{ data: lock }, balances, { data: riwayat }] = await Promise.all([
    supabase.from("accounting_locks")
      .select("closed_until, updated_at, auto_kunci, auto_kunci_jeda_hari").eq("id", true).maybeSingle(),
    getAccountBalances(supabase as never, { to: today }),
    supabase.from("month_end_runs")
      .select("periode, dijalankan_at, sumber, berhasil, ringkasan")
      .order("dijalankan_at", { ascending: false }).limit(6),
  ]);
  const closedUntil = (lock?.closed_until as string | null) ?? null;
  const autoKunci = !!lock?.auto_kunci;
  const jedaHari = Number(lock?.auto_kunci_jeda_hari ?? 5);
  const { laba } = buildClosingLines(balances);

  const periodeLalu = periodeSelesai(today);
  const sudahDikunci = !!closedUntil && closedUntil >= tanggalTerakhir(periodeLalu);
  type Run = { periode: string; dijalankan_at: string; sumber: string; berhasil: boolean; ringkasan: string | null };
  const riwayatRun = (riwayat ?? []) as Run[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Tutup Buku & Kunci Periode</span>
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
          title="KUNCI PERIODE"
          desc="Semua jurnal bertanggal sampai dengan tanggal kunci tidak bisa ditambah, diubah, atau dihapus (dijaga di level database)."
        />
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div className="flab">Status sekarang</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: closedUntil ? "#b45309" : "var(--tm)" }}>
              {closedUntil ? `Terkunci s/d ${fmtD(closedUntil)}` : "Belum ada periode terkunci"}
            </div>
          </div>
          <form action={setKunci} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div>
              <label className="flab">Kunci s/d tanggal</label>
              <input className="fi" type="date" name="closed_until" defaultValue={closedUntil ?? ""} style={{ width: 150 }} />
            </div>
            <button type="submit" className="btn-acc"><i className="ti ti-lock" /> Simpan kunci</button>
          </form>
          {closedUntil && (
            <form action={setKunci}>
              <input type="hidden" name="closed_until" value="" />
              <button type="submit" className="btn-def" style={{ color: "#b91c1c" }}>
                <i className="ti ti-lock-open" /> Lepas kunci
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Proses akhir bulan otomatis (S8) — tiga pekerjaan awal bulan yang dulu manual. */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="PROSES AKHIR BULAN OTOMATIS"
          desc="Tiap tanggal 1 dini hari: posting penyusutan aset, posting jurnal berulang, lalu (kalau dinyalakan) mengunci bulan yang sudah lewat."
        />

        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div className="flab">Bulan terakhir yang sudah selesai</div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{labelBulan(periodeLalu)}</div>
          </div>
          <div>
            <div className="flab">Sudah dikunci?</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: sudahDikunci ? "#15803d" : "#b45309" }}>
              {sudahDikunci ? "Sudah" : "Belum"}
            </div>
          </div>
          <div>
            <div className="flab">Penguncian otomatis</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: autoKunci ? "#15803d" : "var(--tm)" }}>
              {autoKunci ? `Menyala · tenggang ${jedaHari} hari` : "Mati"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 18, alignItems: "flex-end", flexWrap: "wrap" }}>
          <form action={simpanAturanAkhirBulan} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
              <input type="checkbox" name="auto_kunci" defaultChecked={autoKunci} />
              Kunci periode otomatis
            </label>
            <div>
              <label className="flab">Masa tenggang (hari)</label>
              <input className="fi" type="number" name="jeda" min={0} max={28} defaultValue={jedaHari} style={{ width: 90 }} />
            </div>
            <button type="submit" className="btn-def"><i className="ti ti-device-floppy" /> Simpan aturan</button>
          </form>

          <form action={jalankanAkhirBulanSekarang} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
              <input type="checkbox" name="kunci_sekalian" />
              Sekalian kunci {labelBulan(periodeLalu)}
            </label>
            <button type="submit" className="btn-acc"><i className="ti ti-player-play" /> Jalankan sekarang</button>
          </form>
        </div>

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 10, lineHeight: 1.7 }}>
          Aman dijalankan berulang: penyusutan dikunci per aset per bulan, jurnal berulang dikunci
          per periode, dan penguncian hanya maju — tidak ada yang tercatat dua kali.<br />
          Masa tenggang memberi waktu untuk transaksi susulan yang wajar (faktur pemasok telat
          datang, setoran hari terakhir baru dicatat tanggal 2). Mengunci tepat tengah malam
          tanggal 1 membuat pekerjaan itu mustahil tanpa membuka kunci lagi.
        </div>

        {riwayatRun.length > 0 && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Periode</th>
                  <th style={{ width: 150 }}>Dijalankan</th>
                  <th style={{ width: 90 }}>Sumber</th>
                  <th>Hasil</th>
                </tr>
              </thead>
              <tbody>
                {riwayatRun.map((r, i) => (
                  <tr key={`${r.periode}-${i}`}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelBulan(r.periode)}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {new Date(r.dijalankan_at).toLocaleString("id-ID", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
                      })}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {r.sumber === "cron" ? "otomatis" : "manual"}
                    </td>
                    <td style={{ fontSize: 10.5, color: r.berhasil ? "var(--tm)" : "#b91c1c" }}>
                      {r.ringkasan ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="crm-sec">
        <SecHeader
          num="03"
          title="TUTUP BUKU"
          desc="Jurnal penutup: seluruh saldo pendapatan & beban s/d tanggal tutup dipindah ke Laba Ditahan (3201), lalu periode otomatis dikunci."
        />
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div className="flab">Laba/rugi berjalan (s/d hari ini)</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: laba >= 0 ? "#15803d" : "#b91c1c" }}>{rp(laba)}</div>
          </div>
          <form action={tutupBuku} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div>
              <label className="flab">Tutup buku s/d tanggal *</label>
              <input className="fi" type="date" name="tanggal" defaultValue={today} required style={{ width: 150 }} />
            </div>
            <button type="submit" className="btn-acc" style={{ background: "#16213e" }}>
              <i className="ti ti-book-off" /> Tutup buku
            </button>
          </form>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Aman diulang: tutup buku berikutnya hanya menangkap transaksi baru setelah tutup buku sebelumnya.
          Salah tutup? Lepas kunci di atas, hapus jurnal penutup di Jurnal Umum, lalu ulangi.
        </div>
      </div>
    </>
  );
}
