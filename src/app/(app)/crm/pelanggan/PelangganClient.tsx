"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { updateKategoriPelanggan, KATEGORI_OPTIONS } from "./actions";

export type PetRow = {
  id: string; name: string; species: string | null; breed: string | null;
  gender: string | null; dob: string | null; weight: number | null;
  warna: string | null; sterilisasi: string | null; golongan_darah: string | null;
  status: string; created_at: string;
};
export type Purchase = { tgl: string; produk: string; qty: number; total: number; cabang: string; anabul: string };
export type Ledger = { tgl: string; desc: string; delta: number; saldo: number };
export type UnitStat = { petshopCount: number; petshopTotal: number; klinikCount: number; klinikTotal: number };
export type CustomerRow = {
  id: string; name: string; phone: string; email: string | null;
  dob: string | null; address: string | null; tier: string | null;
  kategori: string; points: number; total_spending: number;
  catatan: string | null; pekerjaan: string | null; sumber_info: string | null;
  created_at: string; pets: PetRow[];
  purchases: Purchase[]; ledger: Ledger[]; stat: UnitStat | null;
};

const fmt = (n: number) => n.toLocaleString("id-ID");
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const pctStr = (n: number, total: number) =>
  total ? (Math.round((n / total) * 1000) / 10).toString().replace(".", ",") + "%" : "0%";

const PALETTE = ["#7c3aed", "#2563eb", "#d97757", "#16a34a", "#db2777", "#0891b2", "#ca8a04"];
function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}
function usia(dob: string | null) {
  if (!dob) return "—";
  const d = new Date(dob), now = new Date();
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m--;
  if (m < 0) return "—";
  const y = Math.floor(m / 12), mm = m % 12;
  return y > 0 ? `${y} thn${mm ? ` ${mm} bln` : ""}` : `${mm} bln`;
}

const TIER_CFG: Record<string, { label: string; bg: string; bd: string; color: string; icon: string }> = {
  Bronze: { label: "Bronze", bg: "#fef3c7", bd: "#fde68a", color: "#92400e", icon: "ti-medal" },
  Silver: { label: "Silver", bg: "#f3f4f6", bd: "#e5e7eb", color: "#4b5563", icon: "ti-medal" },
  Gold: { label: "Gold", bg: "#fef9c3", bd: "#fef08a", color: "#713f12", icon: "ti-medal" },
  Platinum: { label: "Platinum", bg: "#ede9fe", bd: "#ddd6fe", color: "#5b21b6", icon: "ti-crown" },
};
const TIER_ORDER = ["Bronze", "Silver", "Gold", "Platinum"];

function TierBadge({ c }: { c: CustomerRow }) {
  const cfg = c.tier ? TIER_CFG[c.tier] : null;
  if (!cfg) return <span style={{ color: "var(--td)" }}>—</span>;
  return <span className="bge" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>;
}
function KategoriBadge({ v }: { v: string }) {
  return <span className="bge" style={{ background: "#eff6ff", color: "#1d4ed8" }}>{v}</span>;
}

function SecHeader({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: ".5px solid var(--bd)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 38, height: 38, background: "#16213e", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{num}</span>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--tx)", letterSpacing: ".01em" }}>{title}</div>
          <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 2 }}>{desc}</div>
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "#141413", lineHeight: 1 }}>
          KAM<i className="ti ti-paw" style={{ fontSize: 13, verticalAlign: -1 }} />
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 600, color: "#9ca3af", letterSpacing: ".1em", marginTop: 2 }}>PET CARE</div>
      </div>
    </div>
  );
}

function Donut({ total, memberFrac, size = 110 }: { total: number; memberFrac: number; size?: number }) {
  const cx = size / 2, r = cx * 0.76, sw = r * 0.32, C = 2 * Math.PI * r;
  const m = C * memberFrac, nm = C * (1 - memberFrac);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f3f4f6" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#9ca3af" strokeWidth={sw} strokeDasharray={`${nm} ${m}`} strokeDashoffset={-m} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#16213e" strokeWidth={sw} strokeDasharray={`${m} ${nm}`} />
      </g>
      <text x={cx} y={cx - 3} textAnchor="middle" fontSize={size * 0.2} fontWeight={700} fill="#141413" fontFamily="system-ui,sans-serif">{fmt(total)}</text>
      <text x={cx} y={cx + 11} textAnchor="middle" fontSize={size * 0.082} fill="#6b7280" fontFamily="system-ui,sans-serif">Total</text>
    </svg>
  );
}

function Av({ initials: ini, color, size = 28 }: { initials: string; color: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.37, fontWeight: 600, color: "#fff", flexShrink: 0 }}>{ini}</div>
  );
}

// ponytail: program member is static config. §1.4 wants a loyalty_programs table — add with the POS/loyalty module.
const PROGRAM_MEMBER = [
  { icon: "ti-gift", label: "Diskon Birthday", desc: "10% di bulan ulang tahun", color: "#d97757" },
  { icon: "ti-cash-banknote", label: "Cashback Bulanan", desc: "2% dari total belanja", color: "#16a34a" },
  { icon: "ti-vaccine", label: "Gratis Vaksin", desc: "1x / tahun untuk member Gold+", color: "#2563eb" },
];

type DetailTab = "pembelian" | "program" | "catatan";

export function PelangganClient({ customers, isAdmin }: { customers: CustomerRow[]; isAdmin: boolean }) {
  const [selId, setSelId] = useState<string | null>(customers[0]?.id ?? null);
  const [tab, setTab] = useState<DetailTab>("pembelian");
  const [q, setQ] = useState("");

  const agg = useMemo(() => {
    const total = customers.length;
    const member = customers.filter((c) => c.kategori === "Member").length;
    const tierCounts: Record<string, number> = {};
    for (const k of TIER_ORDER) tierCounts[k] = customers.filter((c) => c.tier === k).length;
    return { total, member, nonMember: total - member, tierCounts };
  }, [customers]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s));
  }, [customers, q]);

  const sel = customers.find((c) => c.id === selId) ?? null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Data Pelanggan</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Section 01: Stats */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DATA PELANGGAN" desc="Ringkasan pelanggan berdasarkan kategori dan keanggotaan." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginBottom: 12 }}>
            {TIER_ORDER.map((k) => {
              const t = TIER_CFG[k];
              return (
                <div key={k} style={{ background: t.bg, border: `.5px solid ${t.bd}`, borderRadius: 8, padding: "10px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
                    <i className={`ti ${t.icon}`} style={{ color: t.color, fontSize: 15 }} />
                    <span style={{ fontSize: 8, fontWeight: 700, color: t.color, letterSpacing: ".05em" }}>{t.label.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#141413", lineHeight: 1 }}>{fmt(agg.tierCounts[k])}</div>
                  <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>Pelanggan</div>
                  <div style={{ fontSize: 9.5, color: t.color, marginTop: 2, fontWeight: 600 }}>{pctStr(agg.tierCounts[k], agg.total)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "12px 10px" }}>
              <div style={{ fontSize: 8.5, fontWeight: 600, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 11 }}>KATEGORI KEANGGOTAAN</div>
              {[
                { iconColor: "#2563eb", iconBg: "#eff6ff", label: "MEMBER", count: agg.member, pctColor: "#2563eb" },
                { iconColor: "#9ca3af", iconBg: "#f3f4f6", label: "NON MEMBER", count: agg.nonMember, pctColor: "#6b7280" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: row.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className="ti ti-user" style={{ color: row.iconColor, fontSize: 15 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 8.5, fontWeight: 700, color: row.pctColor, letterSpacing: ".04em" }}>{row.label}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#141413", lineHeight: 1.1 }}>{fmt(row.count)}</div>
                    <div style={{ fontSize: 8.5, color: "var(--tm)" }}>Pelanggan</div>
                    <div style={{ fontSize: 10, color: row.pctColor, fontWeight: 600 }}>{pctStr(row.count, agg.total)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "12px 10px" }}>
              <div style={{ fontSize: 8.5, fontWeight: 600, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 8 }}>DISTRIBUSI PELANGGAN</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <Donut total={agg.total} memberFrac={agg.total ? agg.member / agg.total : 0} size={110} />
                <div style={{ width: "100%" }}>
                  {TIER_ORDER.map((k) => {
                    const t = TIER_CFG[k];
                    return (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                        <div style={{ width: 9, height: 9, borderRadius: 2, background: t.bg, border: `.5px solid ${t.bd}`, flexShrink: 0 }} />
                        <span style={{ fontSize: 9, color: t.color }}>{t.label} ({pctStr(agg.tierCounts[k], agg.total)})</span>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: "#f3f4f6", border: ".5px solid #e5e7eb", flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: "#6b7280" }}>Non Member ({pctStr(agg.nonMember, agg.total)})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 02: Customer List */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="DAFTAR PELANGGAN" desc="Data pelanggan berdasarkan kategori dan keanggotaan." />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Link href="/crm/pelanggan/baru" className="btn-acc" style={{ fontSize: 11 }}>
              <i className="ti ti-plus" /> Tambah pelanggan
            </Link>
            <div style={{ position: "relative", width: 220 }}>
              <input className="fi" placeholder="Cari nama / no. HP..." value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: 11, paddingRight: 26 }} />
              <i className="ti ti-search" style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 11, pointerEvents: "none" }} />
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 500 }}>
              <thead>
                <tr>
                  <th>No.</th><th>Nama Pelanggan</th><th>Kategori</th><th>Tier</th>
                  <th style={{ textAlign: "right" }}>Total Pembelian</th>
                  <th style={{ textAlign: "center" }}>Anabul</th>
                  <th>Terdaftar Sejak</th><th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.id} style={{ cursor: "pointer", background: selId === c.id ? "rgba(217,119,87,.06)" : undefined, transition: "background .1s" }} onClick={() => setSelId(c.id)}>
                    <td style={{ color: "var(--td)", fontSize: 11 }}>{i + 1}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Av initials={initials(c.name)} color={colorFor(c.id)} size={25} />
                        <span style={{ fontWeight: 500, fontSize: 11.5 }}>{c.name}</span>
                      </div>
                    </td>
                    <td><KategoriBadge v={c.kategori} /></td>
                    <td><TierBadge c={c} /></td>
                    <td style={{ textAlign: "right", fontWeight: 500, fontSize: 11 }}>{rp(c.total_spending)}</td>
                    <td style={{ textAlign: "center" }}>{c.pets.length}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(c.created_at)}</td>
                    <td>
                      <button className="back-btn" title="Lihat detail" onClick={(e) => { e.stopPropagation(); setSelId(c.id); }}>
                        <i className="ti ti-eye" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada pelanggan.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: "var(--tm)" }}>Menampilkan {filtered.length} dari {customers.length} pelanggan</div>
        </div>
      </div>

      {/* Section 03: Pets + detail */}
      <div className="crm-sec">
        <SecHeader num="03" title="DATA ANABUL PELANGGAN" desc="Rincian hewan peliharaan (anabul) yang terdaftar pada pelanggan terpilih." />
        {!sel ? (
          <div style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 12 }}>Pilih pelanggan untuk lihat detail.</div>
        ) : (
          <>
            <div className="grid2" style={{ alignItems: "start" }}>
              <div style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: ".5px solid var(--bd)" }}>
                  <Av initials={initials(sel.name)} color={colorFor(sel.id)} size={40} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{sel.name}</div>
                    <div style={{ marginTop: 4, display: "flex", gap: 5 }}><KategoriBadge v={sel.kategori} /><TierBadge c={sel} /></div>
                    {isAdmin && (
                      <form action={updateKategoriPelanggan} style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="hidden" name="id" value={sel.id} />
                        <label style={{ fontSize: 10, color: "var(--tm)" }}>Kategori:</label>
                        <select name="kategori" defaultValue={sel.kategori} className="fi" style={{ width: "auto", fontSize: 11, padding: "4px 8px" }} key={`kat-${sel.id}`}>
                          {KATEGORI_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <button type="submit" className="btn-acc" style={{ fontSize: 10, padding: "4px 10px" }}>Simpan</button>
                      </form>
                    )}
                  </div>
                  <div style={{ fontSize: 9.5, color: "var(--td)", textAlign: "right" }}>Terdaftar sejak<br />{fmtDate(sel.created_at)}</div>
                </div>
                {([
                  { icon: "ti-phone", label: "No. Handphone", val: sel.phone },
                  { icon: "ti-mail", label: "Email", val: sel.email ?? "—" },
                  { icon: "ti-briefcase", label: "Pekerjaan", val: sel.pekerjaan ?? "—" },
                  { icon: "ti-map-pin", label: "Alamat", val: sel.address ?? "—" },
                  { icon: "ti-broadcast", label: "Sumber Info", val: sel.sumber_info ?? "—" },
                  { icon: "ti-cash", label: "Total Pembelian", val: rp(sel.total_spending) },
                  { icon: "ti-star", label: "Poin Reward", val: `${fmt(sel.points)} Poin` },
                ] as const).map((row) => (
                  <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: ".5px solid var(--bd)" }}>
                    <i className={`ti ${row.icon}`} style={{ color: "var(--tm)", fontSize: 14, width: 18, textAlign: "center" }} />
                    <span style={{ fontSize: 11, color: "var(--tm)", flex: 1 }}>{row.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 500, textAlign: "right", maxWidth: 180 }}>{row.val}</span>
                  </div>
                ))}
                {isAdmin && sel.stat && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: ".5px solid var(--bd)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 6 }}>RINCIAN TRANSAKSI (ADMIN)</div>
                    {[
                      { unit: "Petshop", count: sel.stat.petshopCount, total: sel.stat.petshopTotal },
                      { unit: "Klinik", count: sel.stat.klinikCount, total: sel.stat.klinikTotal },
                    ].map((u) => (
                      <div key={u.unit} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>
                        <span>{u.unit}</span>
                        <span>{u.count}x · {rp(u.total)} · rata2 {rp(u.count ? u.total / u.count : 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: ".5px solid var(--bd)" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 5 }}>CATATAN</div>
                  <div style={{ fontSize: 10.5, color: "var(--tm)", lineHeight: 1.5 }}>{sel.catatan ?? "—"}</div>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 12, letterSpacing: ".03em" }}>DAFTAR ANABUL</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--td)" }}>{sel.pets.length} ekor</span>
                    <Link href={`/crm/anabul/baru?customer=${sel.id}`} className="btn-acc" style={{ fontSize: 10, padding: "4px 9px" }}>
                      <i className="ti ti-plus" /> Tambah anabul
                    </Link>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="tbl" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th>No.</th><th>Nama</th><th>Jenis</th><th>Ras</th><th>Kelamin</th>
                        <th>Usia</th><th>Gol. Darah</th><th>Steril</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sel.pets.map((p, i) => (
                        <tr key={p.id}>
                          <td style={{ color: "var(--td)", fontSize: 11 }}>{i + 1}</td>
                          <td style={{ fontWeight: 500 }}>{p.name}</td>
                          <td style={{ color: "var(--tm)" }}>{p.species ?? "—"}</td>
                          <td style={{ fontSize: 11, color: "var(--tm)" }}>{p.breed ?? "—"}</td>
                          <td>
                            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: p.gender === "Jantan" ? "#2563eb" : "#db2777" }}>
                              <i className={`ti ti-gender-${p.gender === "Jantan" ? "male" : "female"}`} style={{ fontSize: 13 }} />{p.gender ?? "—"}
                            </span>
                          </td>
                          <td style={{ fontSize: 11, color: "var(--tm)" }}>{usia(p.dob)}</td>
                          <td>{p.golongan_darah ? <span className="bge r">{p.golongan_darah}</span> : <span style={{ color: "var(--td)" }}>—</span>}</td>
                          <td style={{ fontSize: 11, color: "var(--tm)" }}>{p.sterilisasi ?? "—"}</td>
                          <td><span className={`bge ${p.status === "Aktif" ? "g" : p.status === "RIP" ? "x" : "o"}`}>{p.status}</span></td>
                        </tr>
                      ))}
                      {sel.pets.length === 0 && (
                        <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>Belum ada anabul terdaftar</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: ".5px solid var(--bd)" }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                {([
                  { key: "pembelian", label: "Riwayat Pembelian" },
                  { key: "program", label: "Program & Poin" },
                  { key: "catatan", label: "Catatan" },
                ] as const).map((t) => (
                  <button key={t.key} onClick={() => setTab(t.key)} style={{
                    padding: "6px 14px", fontSize: 11.5, fontWeight: 500, borderRadius: 7, cursor: "pointer", border: ".5px solid var(--bd)",
                    background: tab === t.key ? "var(--sb)" : "#fff", color: tab === t.key ? "#fff" : "var(--tm)",
                  }}>{t.label}</button>
                ))}
              </div>

              {tab === "pembelian" && (
                <div style={{ overflowX: "auto" }}>
                  <table className="tbl" style={{ minWidth: 540 }}>
                    <thead>
                      <tr><th>Tanggal</th><th>Produk</th><th>Anabul</th><th style={{ textAlign: "center" }}>Qty</th><th style={{ textAlign: "right" }}>Total</th><th>Cabang</th></tr>
                    </thead>
                    <tbody>
                      {sel.purchases.map((p, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(p.tgl)}</td>
                          <td style={{ fontWeight: 500 }}>{p.produk}</td>
                          <td style={{ fontSize: 11, color: "var(--tm)" }}>{p.anabul}</td>
                          <td style={{ textAlign: "center" }}>{p.qty}</td>
                          <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp(p.total)}</td>
                          <td style={{ fontSize: 11, color: "var(--tm)" }}>{p.cabang}</td>
                        </tr>
                      ))}
                      {sel.purchases.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>Belum ada transaksi.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "program" && (
                <div className="grid2" style={{ alignItems: "start" }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 8 }}>PROGRAM MEMBER</div>
                    {PROGRAM_MEMBER.map((p) => (
                      <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: ".5px solid var(--bd)", borderRadius: 8, marginBottom: 7 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 7, background: `${p.color}1a`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <i className={`ti ${p.icon}`} style={{ color: p.color, fontSize: 15 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{p.label}</div>
                          <div style={{ fontSize: 10, color: "var(--tm)" }}>{p.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em" }}>POIN REWARD</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--acc)" }}>{fmt(sel.points)} poin</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="tbl">
                        <thead><tr><th>Tanggal</th><th>Deskripsi</th><th style={{ textAlign: "right" }}>Poin</th><th style={{ textAlign: "right" }}>Saldo</th></tr></thead>
                        <tbody>
                          {sel.ledger.map((l, i) => (
                            <tr key={i}>
                              <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(l.tgl)}</td>
                              <td style={{ fontSize: 11 }}>{l.desc}</td>
                              <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: l.delta >= 0 ? "#15803d" : "#b91c1c" }}>{l.delta >= 0 ? "+" : ""}{l.delta}</td>
                              <td style={{ textAlign: "right", fontSize: 11 }}>{fmt(l.saldo)}</td>
                            </tr>
                          ))}
                          {sel.ledger.length === 0 && (
                            <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>Belum ada riwayat poin.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === "catatan" && (
                <div style={{ fontSize: 11.5, color: "var(--tm)", lineHeight: 1.6, padding: "4px 0" }}>{sel.catatan ?? "—"}</div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
