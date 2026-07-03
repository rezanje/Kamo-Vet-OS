import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { openShift, closeShift, forceCloseShift } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: open } = await supabase
    .from("cashier_shifts")
    .select("id, opening_balance, opened_at, branch_id, branches(name)")
    .eq("opened_by", user?.id ?? "")
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .maybeSingle();

  // penjualan tunai selama shift berjalan (untuk expected kas).
  let tunai = 0, trxCount = 0;
  if (open) {
    const { data: cs } = await supabase.from("sales").select("total").eq("shift_id", open.id).eq("metode_bayar", "Tunai");
    tunai = (cs ?? []).reduce((a, s) => a + Number(s.total), 0);
    trxCount = (cs ?? []).length;
  }
  const expected = open ? Number(open.opening_balance) + tunai : 0;

  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const { data: history } = await supabase
    .from("cashier_shifts")
    .select("id, shift_type, opening_balance, closing_balance, expected_cash, selisih, opened_at, closed_at, branches(name)")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(10);

  // Addendum §1: shift nyangkut >24 jam (staff lupa tutup) — manajer bisa force-close.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from("cashier_shifts")
    .select("id, shift_type, opening_balance, opened_at, branches(name), profiles(full_name)")
    .eq("status", "open")
    .lt("opened_at", dayAgo)
    .order("opened_at");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const isManager = !!me && ["OWNER", "ADMIN"].includes(me.role);

  const openBranch = one(open?.branches as Rel<{ name: string }>);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Shift Kasir</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "open" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Shift dibuka. Kasir siap transaksi.</div>}
      {success === "close" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Shift ditutup & direkonsiliasi.</div>}
      {success === "force" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Shift ditutup paksa oleh manajer.</div>}

      <div className="crm-sec">
        {open ? (
          <>
            <SecHeader num="01" title="SHIFT BERJALAN" desc={`${openBranch?.name ?? "—"} · dibuka ${fmtDt(open.opened_at)}`} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
              <Stat label="Modal awal" value={rp(open.opening_balance)} />
              <Stat label="Penjualan tunai" value={rp(tunai)} sub={`${trxCount} transaksi`} />
              <Stat label="Kas seharusnya" value={rp(expected)} accent />
              <Stat label="Non-tunai" value="QRIS/Transfer" sub="tidak masuk kas" muted />
            </div>
            <form action={closeShift} style={{ display: "flex", gap: 8, alignItems: "flex-end", borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
              <input type="hidden" name="shiftId" value={open.id} />
              <div style={{ flex: 1, maxWidth: 240 }}>
                <label className="flab">Uang kas dihitung (tutup shift)</label>
                <input className="fi" name="closing_balance" type="number" min={0} step={1000} placeholder="Hitung fisik uang di laci" required />
              </div>
              <button type="submit" className="btn-acc"><i className="ti ti-lock" /> Selesai Shift</button>
            </form>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>Selisih (kas dihitung − kas seharusnya) dicatat otomatis untuk rekonsiliasi keuangan.</div>
          </>
        ) : (
          <>
            <SecHeader num="01" title="MULAI SHIFT" desc="Masukkan modal awal kas sebelum transaksi." />
            <form action={openShift} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1, maxWidth: 220 }}>
                <label className="flab">Cabang *</label>
                <select className="fi" name="branchId" required>
                  <option value="">Pilih cabang</option>
                  {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, maxWidth: 200 }}>
                <label className="flab">Uang di kasir saat ini (modal awal)</label>
                <input className="fi" name="opening_balance" type="number" min={0} step={1000} placeholder="500000" required />
              </div>
              <button type="submit" className="btn-acc"><i className="ti ti-player-play" /> Mulai Shift</button>
            </form>
          </>
        )}
      </div>

      {(stale ?? []).length > 0 && (
        <div className="crm-sec">
          <SecHeader num="!" title="SHIFT NYANGKUT (>24 JAM)" desc="Staff lupa tutup shift — manajer cabang bisa tutup paksa (Addendum §1)." />
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead><tr><th>Dibuka</th><th>Kasir</th><th>Cabang</th><th>Tipe</th><th style={{ textAlign: "right" }}>Modal</th><th /></tr></thead>
            <tbody>
              {(stale ?? []).map((s) => {
                const br = one(s.branches as Rel<{ name: string }>);
                const kasir = one(s.profiles as Rel<{ full_name: string | null }>);
                return (
                  <tr key={s.id}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDt(s.opened_at)}</td>
                    <td style={{ fontSize: 11 }}>{kasir?.full_name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{br?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}><span className="bge o">{s.shift_type}</span></td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(s.opening_balance)}</td>
                    <td style={{ textAlign: "right" }}>
                      {isManager ? (
                        <form action={forceCloseShift} style={{ display: "inline" }}>
                          <input type="hidden" name="shiftId" value={s.id} />
                          <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                            <i className="ti ti-lock-x" /> Tutup Paksa
                          </button>
                        </form>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--td)" }}>hanya manajer</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="02" title="RIWAYAT SHIFT" desc="Shift yang sudah ditutup & selisih kasnya." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr><th>Buka</th><th>Tutup</th><th>Cabang</th><th>Tipe</th><th style={{ textAlign: "right" }}>Modal</th><th style={{ textAlign: "right" }}>Seharusnya</th><th style={{ textAlign: "right" }}>Dihitung</th><th style={{ textAlign: "right" }}>Selisih</th><th /></tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => {
                const br = one(h.branches as Rel<{ name: string }>);
                const sel = Number(h.selisih);
                return (
                  <tr key={h.id}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDt(h.opened_at)}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{h.closed_at ? fmtDt(h.closed_at) : "—"}</td>
                    <td style={{ fontSize: 11 }}>{br?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}><span className={`bge ${h.shift_type === "klinik" ? "b" : "g"}`}>{h.shift_type}</span></td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.opening_balance)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.expected_cash ?? 0)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(h.closing_balance ?? 0)}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: sel === 0 ? "#15803d" : sel > 0 ? "#1d4ed8" : "#b91c1c" }}>
                      {sel > 0 ? "+" : ""}{rp(sel)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/pos/shift/${h.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none" }}>
                        <i className="ti ti-file-text" /> Laporan
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {(history ?? []).length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada shift ditutup.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub, accent, muted }: { label: string; value: string; sub?: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="card" style={{ padding: "11px 13px" }}>
      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: muted ? 12 : 16, fontWeight: 700, color: accent ? "var(--acc)" : muted ? "var(--td)" : "#141413", marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "var(--td)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
