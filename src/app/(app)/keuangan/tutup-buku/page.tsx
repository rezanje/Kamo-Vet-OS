import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";
import { buildClosingLines } from "@/lib/tutup-buku";
import { setKunci, tutupBuku } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function TutupBukuPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: lock }, balances] = await Promise.all([
    supabase.from("accounting_locks").select("closed_until, updated_at").eq("id", true).maybeSingle(),
    getAccountBalances(supabase as never, { to: today }),
  ]);
  const closedUntil = (lock?.closed_until as string | null) ?? null;
  const { laba } = buildClosingLines(balances);

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

      <div className="crm-sec">
        <SecHeader
          num="02"
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
