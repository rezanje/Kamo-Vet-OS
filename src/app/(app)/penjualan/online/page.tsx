import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { tandaiCair } from "./actions";

type Row = {
  id: string;
  no_struk: string | null;
  created_at: string;
  channel: string | null;
  buyer_name: string | null;
  external_ref: string | null;
  total: number;
  komisi: number;
  marketplace_status: string | null;
  customers: { name: string } | { name: string }[] | null;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const fmtD = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

const CHANNEL_STYLE: Record<string, { bg: string; fg: string }> = {
  "Shopee": { bg: "#fff1eb", fg: "#ea580c" },
  "Tokopedia": { bg: "#e8f5ee", fg: "#16a34a" },
  "TikTok Shop": { bg: "#f4f4f5", fg: "#3f3f46" },
  "WA": { bg: "#e8f5ee", fg: "#15803d" },
};

export default async function PenjualanOnlinePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales")
    .select("id, no_struk, created_at, channel, buyer_name, external_ref, total, komisi, marketplace_status, customers(name)")
    .not("channel", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  // Dihitung dari query terpisah TANPA limit — kalau dijumlah dari `rows` (dipaging 200),
  // order piutang di luar 200 terbaru hilang dari total (I4).
  const { data: piutangRows } = await supabase
    .from("sales")
    .select("total")
    .eq("marketplace_status", "piutang");
  const piutang = (piutangRows ?? []).reduce((a, r) => a + Number(r.total), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penjualan Online</span>
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
          title="ORDER ONLINE"
          desc={`Marketplace & WA. Dana marketplace belum cair: ${rp(piutang)}.`}
          action={
            <Link href="/penjualan/online/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Buat order
            </Link>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>Tanggal</th>
                <th>Channel</th>
                <th>Pembeli</th>
                <th>Ref. order</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Komisi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cust = Array.isArray(r.customers) ? r.customers[0] : r.customers;
                const st = CHANNEL_STYLE[r.channel ?? ""] ?? { bg: "#f4f4f5", fg: "#3f3f46" };
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_struk ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.created_at)}</td>
                    <td>
                      <span
                        className="bge"
                        style={{ background: st.bg, color: st.fg, fontSize: 10 }}
                      >
                        {r.channel}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5 }}>{cust?.name ?? r.buyer_name ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.external_ref ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(r.total))}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                      {Number(r.komisi) > 0 ? rp(Number(r.komisi)) : "—"}
                    </td>
                    <td>
                      {r.marketplace_status === "piutang" ? (
                        <form action={tandaiCair} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <input type="hidden" name="sale_id" value={r.id} />
                          <input
                            className="fi" type="number" name="nominal" min={1} step="any" required
                            placeholder="Dana cair" style={{ width: 110, padding: "3px 6px", fontSize: 10.5 }}
                          />
                          <button type="submit" className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }}>
                            Tandai cair
                          </button>
                        </form>
                      ) : r.marketplace_status === "cair" ? (
                        <span className="bge g" style={{ fontSize: 10 }}>Cair</span>
                      ) : (
                        <span className="bge b" style={{ fontSize: 10 }}>Lunas</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada order online.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
