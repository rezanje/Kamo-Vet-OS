import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { JurnalForm } from "./JurnalForm";

// ponytail: jurnal umum — catat + riwayat. Real data dari journal_entries + journal_lines.

type CoaAccount = { id: string; code: string; name: string };
type Branch = { id: string; code: string; name: string };

type JournalLine = { debit: number; credit: number };
type JournalEntry = {
  id: string;
  no_jurnal: string;
  tanggal: string;
  deskripsi: string;
  source: string;
  journal_lines: JournalLine[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  manual:  { label: "Manual",  cls: "x" },
  expense: { label: "Expense", cls: "o" },
  sale:    { label: "Sale",    cls: "b" },
  "sale-hpp": { label: "HPP", cls: "b" },
  shift:   { label: "Shift",   cls: "g" },
  klinik:  { label: "Klinik",  cls: "g" },
  "klinik-edit": { label: "Edit Inv", cls: "o" },
  "klinik-void": { label: "Void Inv", cls: "r" },
  "klinik-ar": { label: "Pelunasan AR", cls: "g" },
  purchase: { label: "Pembelian", cls: "b" },
  "purchase-pay": { label: "Bayar AP", cls: "o" },
  "stock-in": { label: "Stok Masuk", cls: "b" },
  payroll: { label: "Payroll", cls: "x" },
  "bank-rec": { label: "Rekon Bank", cls: "b" },
  asset: { label: "Aset", cls: "x" },
  depreciation: { label: "Penyusutan", cls: "x" },
};

export default async function JurnalPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const [{ data: accData }, { data: branchData }, { data: entryData }] = await Promise.all([
    supabase
      .from("coa_accounts")
      .select("id, code, name")
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("branches")
      .select("id, code, name")
      .order("name"),
    supabase
      .from("journal_entries")
      .select("id, no_jurnal, tanggal, deskripsi, source, journal_lines(debit, credit)")
      .order("tanggal", { ascending: false })
      .limit(30),
  ]);

  const accounts = (accData ?? []) as unknown as CoaAccount[];
  const branches = (branchData ?? []) as unknown as Branch[];
  const entries  = (entryData  ?? []) as unknown as JournalEntry[];

  return (
    <>
      {/* Back link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Jurnal Umum</span>
      </div>

      {/* Banners */}
      {success && (
        <div
          className="p2ban"
          style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#15803d", marginBottom: 10 }}
        >
          <i className="ti ti-circle-check" /> Jurnal berhasil disimpan.
        </div>
      )}
      {error && (
        <div
          className="p2ban"
          style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 10 }}
        >
          <i className="ti ti-alert-circle" /> {decodeURIComponent(error)}
        </div>
      )}

      {/* §01 CATAT JURNAL */}
      <div className="crm-sec" style={{ marginBottom: 14 }}>
        <SecHeader
          num="01"
          title="CATAT JURNAL"
          desc="Jurnal umum manual — minimal 2 baris, harus balance (total debit = total kredit)."
        />
        <JurnalForm accounts={accounts} branches={branches} />
      </div>

      {/* §02 RIWAYAT JURNAL */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="RIWAYAT JURNAL"
          desc="30 entri terbaru — semua sumber (manual, sale, expense, shift)."
        />

        {entries.length === 0 ? (
          <div
            style={{ textAlign: "center", padding: "28px 0", color: "var(--td)", fontSize: 12 }}
          >
            <i
              className="ti ti-notebook"
              style={{ fontSize: 26, display: "block", marginBottom: 8, opacity: 0.35 }}
            />
            Belum ada jurnal tercatat.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>No. Jurnal</th>
                  <th style={{ width: 90 }}>Tanggal</th>
                  <th>Deskripsi</th>
                  <th style={{ width: 80, textAlign: "center" }}>Sumber</th>
                  <th style={{ width: 120, textAlign: "right" }}>Total Debit</th>
                  <th style={{ width: 120, textAlign: "right" }}>Total Kredit</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const lines = Array.isArray(e.journal_lines) ? e.journal_lines : [];
                  const totD = lines.reduce((a, l) => a + Number(l.debit),  0);
                  const totK = lines.reduce((a, l) => a + Number(l.credit), 0);
                  const badge = SOURCE_BADGE[e.source] ?? { label: e.source, cls: "g" };
                  const tgl = e.tanggal ? new Date(e.tanggal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
                  return (
                    <tr key={e.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                        {e.no_jurnal}
                      </td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl}</td>
                      <td style={{ fontSize: 11, maxWidth: 200 }}>{e.deskripsi}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`bge ${badge.cls}`} style={{ fontSize: 9 }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 10.5, color: "#2563eb" }}>
                        {rp(totD)}
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 10.5, color: "#16a34a" }}>
                        {rp(totK)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
