import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

// ponytail: COA read-only — grouped by type, order ASET→LIABILITAS→EKUITAS→PENDAPATAN→BEBAN.
// No create/edit (task constraint). Data from coa_accounts table.

type CoaAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  is_active: boolean;
};

const TYPE_ORDER = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"] as const;

const TYPE_LABELS: Record<string, string> = {
  ASET: "Aset",
  LIABILITAS: "Liabilitas",
  EKUITAS: "Ekuitas",
  PENDAPATAN: "Pendapatan",
  BEBAN: "Beban",
};

const TYPE_DESC: Record<string, string> = {
  ASET: "Harta & sumber daya yang dimiliki perusahaan.",
  LIABILITAS: "Kewajiban & hutang kepada pihak ketiga.",
  EKUITAS: "Modal pemilik & laba ditahan.",
  PENDAPATAN: "Penghasilan dari kegiatan operasional.",
  BEBAN: "Pengeluaran untuk menjalankan operasional.",
};

export default async function CoaPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coa_accounts")
    .select("id, code, name, type, normal_balance, is_active")
    .order("code");

  const accounts = (data ?? []) as unknown as CoaAccount[];

  // Group by type
  const groups: Record<string, CoaAccount[]> = {};
  for (const acc of accounts) {
    if (!groups[acc.type]) groups[acc.type] = [];
    groups[acc.type].push(acc);
  }

  const hasAny = accounts.length > 0;

  return (
    <>
      {/* Back link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Chart of Accounts</span>
      </div>

      {error && (
        <div
          className="p2ban"
          style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}
        >
          <i className="ti ti-alert-circle" /> Gagal memuat data akun: {error.message}
        </div>
      )}

      {!hasAny && !error && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="BAGAN AKUN (COA)"
            desc="Daftar akun belum ada. Tambahkan akun melalui migrasi seed."
          />
          <div
            style={{
              textAlign: "center",
              padding: "32px 0",
              color: "var(--td)",
              fontSize: 12,
            }}
          >
            <i className="ti ti-books" style={{ fontSize: 28, display: "block", marginBottom: 8, opacity: 0.4 }} />
            Belum ada akun terdaftar di COA.
          </div>
        </div>
      )}

      {hasAny &&
        TYPE_ORDER.map((type, idx) => {
          const rows = groups[type] ?? [];
          if (rows.length === 0) return null;
          const num = String(idx + 1).padStart(2, "0");
          return (
            <div key={type} className="crm-sec" style={{ marginBottom: 14 }}>
              <SecHeader
                num={num}
                title={`${type} — ${TYPE_LABELS[type]}`}
                desc={TYPE_DESC[type]}
              />
              <div style={{ overflowX: "auto" }}>
                <table className="tbl" style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Kode</th>
                      <th>Nama Akun</th>
                      <th style={{ width: 120, textAlign: "center" }}>Saldo Normal</th>
                      <th style={{ width: 80, textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((acc) => (
                      <tr key={acc.id}>
                        <td style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "var(--tm)" }}>
                          {acc.code}
                        </td>
                        <td style={{ fontSize: 12 }}>{acc.name}</td>
                        <td style={{ textAlign: "center" }}>
                          {acc.normal_balance === "D" ? (
                            <span className="bge b" style={{ fontSize: 9.5 }}>Debit</span>
                          ) : (
                            <span className="bge g" style={{ fontSize: 9.5 }}>Kredit</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {acc.is_active ? (
                            <span className="bge g" style={{ fontSize: 9 }}>Aktif</span>
                          ) : (
                            <span className="bge x" style={{ fontSize: 9 }}>Nonaktif</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6, textAlign: "right" }}>
                {rows.length} akun
              </div>
            </div>
          );
        })}
    </>
  );
}
