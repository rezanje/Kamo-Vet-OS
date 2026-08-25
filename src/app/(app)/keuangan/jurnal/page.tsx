import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { JurnalForm } from "./JurnalForm";
import { NoDok } from "@/components/NoDok";
import { postRecurringCatchUp } from "@/lib/recurring";

// ponytail: jurnal umum — catat + riwayat. Real data dari journal_entries + journal_lines.

type CoaAccount = { id: string; code: string; name: string };
type Branch = { id: string; code: string; name: string };

type Akun = { code: string; name: string };
type JournalLine = { debit: number; credit: number; coa_accounts: Akun | Akun[] | null };
type JournalEntry = {
  id: string;
  no_jurnal: string;
  tanggal: string;
  deskripsi: string;
  source: string;
  source_ref: string | null;
  branches: { name: string } | { name: string }[] | null;
  journal_lines: JournalLine[];
};

const akunDari = (l: JournalLine): Akun | null =>
  Array.isArray(l.coa_accounts) ? (l.coa_accounts[0] ?? null) : l.coa_accounts;

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
  recurring: { label: "Berulang", cls: "x" },
  closing: { label: "Tutup Buku", cls: "r" },
  opname: { label: "Opname", cls: "b" },
  "purchase-invoice": { label: "Faktur Beli", cls: "b" },
  "purchase-return": { label: "Retur Beli", cls: "o" },
  "sales-return": { label: "Retur Jual", cls: "o" },
  "sales-return-hpp": { label: "HPP Retur", cls: "o" },
};

export default async function JurnalPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string; error?: string;
    cari?: string; cabang?: string; sumber?: string; dari?: string; sampai?: string;
  }>;
}) {
  const { success, error, cari = "", cabang = "", sumber = "", dari = "", sampai = "" } = await searchParams;
  const supabase = await createClient();

  // Jurnal berulang: catch-up bulan tertinggal (idempotent via last_posted).
  const recurringPosted = await postRecurringCatchUp(supabase);

  // Saringan dikerjakan di database (bukan memotong 30 baris terakhir di layar),
  // supaya mencari jurnal bulan lalu tidak perlu menggulir ratusan baris.
  let qEntries = supabase
    .from("journal_entries")
    .select("id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id, branches(name), journal_lines(debit, credit, coa_accounts(code, name))")
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (cabang) qEntries = qEntries.eq("branch_id", cabang);
  if (sumber) qEntries = qEntries.eq("source", sumber);
  if (dari) qEntries = qEntries.gte("tanggal", dari);
  if (sampai) qEntries = qEntries.lte("tanggal", sampai);
  if (cari.trim()) {
    const q = cari.trim();
    qEntries = qEntries.or(`no_jurnal.ilike.%${q}%,deskripsi.ilike.%${q}%,source_ref.ilike.%${q}%`);
  }

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
    qEntries,
  ]);

  const accounts = (accData ?? []) as unknown as CoaAccount[];
  const branches = (branchData ?? []) as unknown as Branch[];
  const entries  = (entryData  ?? []) as unknown as JournalEntry[];
  const adaSaringan = !!(cari || cabang || sumber || dari || sampai);

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
      {recurringPosted.length > 0 && (
        <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #93c5fd", color: "#1d4ed8" }}>
          <i className="ti ti-repeat" /> Jurnal berulang otomatis diposting:{" "}
          {recurringPosted.map((p) => `${p.nama} (${p.periode})`).join(", ")}.
        </div>
      )}

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
          desc="Klik nomor jurnalnya untuk melihat akun yang kena; nomor dokumen sumber bisa diklik ke dokumen aslinya."
        />

        {/* Saringan (permintaan Bu Nisa, meeting 14 Agustus) — dulu layar ini hanya
            menampilkan 30 entri terbaru tanpa cara mencari. */}
        <form method="get" style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="flab">Cari</label>
            <input className="fi" name="cari" defaultValue={cari} placeholder="No. jurnal, dokumen, atau keterangan" />
          </div>
          <div style={{ minWidth: 165 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="flab">Sumber</label>
            <select className="fi" name="sumber" defaultValue={sumber}>
              <option value="">Semua sumber</option>
              {Object.entries(SOURCE_BADGE).map(([kode, b]) => <option key={kode} value={kode}>{b.label}</option>)}
            </select>
          </div>
          <div style={{ width: 135 }}>
            <label className="flab">Dari</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div style={{ width: 135 }}>
            <label className="flab">Sampai</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </form>

        <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>
          {entries.length} entri {adaSaringan ? "cocok saringan" : "terbaru"}
          {entries.length === 200 && " (dibatasi 200 — persempit saringannya)"}
        </div>

        {entries.length === 0 ? (
          <div
            style={{ textAlign: "center", padding: "28px 0", color: "var(--td)", fontSize: 12 }}
          >
            <i
              className="ti ti-notebook"
              style={{ fontSize: 26, display: "block", marginBottom: 8, opacity: 0.35 }}
            />
            {adaSaringan ? "Tidak ada jurnal cocok saringan." : "Belum ada jurnal tercatat."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>No. Jurnal</th>
                  <th style={{ width: 90 }}>Tanggal</th>
                  <th>Deskripsi</th>
                  <th style={{ width: 120 }}>Cabang</th>
                  <th style={{ width: 130 }}>No. Dokumen</th>
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
                  const tgl = e.tanggal ? new Date(e.tanggal).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "2-digit" }) : "—";
                  return (
                    <tr key={e.id}>
                      {/* Rinciannya dibuka pakai <details> bawaan browser — tidak perlu
                          halaman baru maupun JavaScript. Sebelum ini layar jurnal hanya
                          menampilkan total, jadi akun yang kena tidak kelihatan di mana pun
                          selain Buku Besar (dilaporkan tim 2026-08-11). */}
                      <td style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                        <details>
                          <summary style={{ cursor: "pointer", listStyle: "none" }}>
                            <i className="ti ti-chevron-right" style={{ fontSize: 11, verticalAlign: "-1px" }} />
                            {e.no_jurnal}
                          </summary>
                          <div style={{ margin: "6px 0 2px", fontFamily: "var(--font, inherit)" }}>
                            {lines.map((l, i) => {
                              const akun = akunDari(l);
                              const debit = Number(l.debit) > 0;
                              return (
                                <div key={i} style={{
                                  display: "flex", justifyContent: "space-between", gap: 10,
                                  fontSize: 10.5, padding: "2px 0", whiteSpace: "nowrap",
                                  paddingLeft: debit ? 0 : 14,
                                }}>
                                  <span style={{ color: "var(--tm)" }}>
                                    <span style={{ fontFamily: "monospace", color: "var(--td)", marginRight: 5 }}>
                                      {akun?.code ?? "—"}
                                    </span>
                                    {akun?.name ?? "(akun terhapus)"}
                                  </span>
                                  <span style={{ fontFamily: "monospace", color: debit ? "#2563eb" : "#16a34a" }}>
                                    {debit ? rp(Number(l.debit)) : rp(Number(l.credit))}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      </td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl}</td>
                      <td style={{ fontSize: 11, maxWidth: 200 }}>{e.deskripsi}</td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                        {(Array.isArray(e.branches) ? e.branches[0] : e.branches)?.name ?? "Pusat"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 10 }}>
                        <NoDok nomor={e.source_ref} />
                      </td>
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
