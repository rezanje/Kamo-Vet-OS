"use client";

import { useState } from "react";
import Link from "next/link";

const fmt = (n: number) => n.toLocaleString("id-ID");
const rp  = (n: number) => "Rp " + n.toLocaleString("id-ID");

const TIERS = [
  { key: "bronze",   label: "BRONZE",   count: 1256, pct: "21,4%", color: "#92400e", bg: "#fef3c7", bd: "#fde68a", icon: "ti-medal"  },
  { key: "silver",   label: "SILVER",   count: 982,  pct: "16,7%", color: "#4b5563", bg: "#f9fafb", bd: "#e5e7eb", icon: "ti-medal"  },
  { key: "gold",     label: "GOLD",     count: 1145, pct: "19,5%", color: "#713f12", bg: "#fef9c3", bd: "#fef08a", icon: "ti-medal"  },
  { key: "platinum", label: "PLATINUM", count: 617,  pct: "10,5%", color: "#5b21b6", bg: "#ede9fe", bd: "#ddd6fe", icon: "ti-crown"  },
];

type Customer = {
  id: string; name: string; initials: string; color: string;
  membership: string; tier: string | null;
  transaksi: number; total: number; anabul: number; since: string;
  phone: string; email: string; points: number;
};

// ponytail: static mock. Wire to customers/pets tables when CRM module lands.
const CUSTOMERS: Customer[] = [
  { id: "C-001", name: "Dewi Sandra",   initials: "DS", color: "#7c3aed", membership: "Member",     tier: "gold",     transaksi: 28, total: 7850000,  anabul: 3, since: "12 Jan 2024", phone: "0812-9876-5432", email: "dewi.s@gmail.com",        points: 7850  },
  { id: "C-002", name: "Andi Rahman",   initials: "AR", color: "#2563eb", membership: "Member",     tier: "silver",   transaksi: 15, total: 3250000,  anabul: 2, since: "05 Mar 2024", phone: "0857-1234-5678", email: "andi.r@gmail.com",         points: 3250  },
  { id: "C-003", name: "Maria Cahyani", initials: "MC", color: "#d97757", membership: "Member",     tier: "platinum", transaksi: 42, total: 12400000, anabul: 4, since: "20 Nov 2023", phone: "0812-3456-7890", email: "maria.cahyani@email.com",  points: 12560 },
  { id: "C-004", name: "Budi Santoso",  initials: "BS", color: "#6b7280", membership: "Non Member", tier: null,       transaksi: 6,  total: 980000,   anabul: 1, since: "02 Apr 2025", phone: "0878-5555-4444", email: "budi.s@yahoo.com",         points: 0     },
  { id: "C-005", name: "Nadia Tania",   initials: "NT", color: "#16a34a", membership: "Member",     tier: "bronze",   transaksi: 9,  total: 1560000,  anabul: 1, since: "18 Feb 2025", phone: "0821-9999-8888", email: "nadia.t@gmail.com",        points: 1560  },
];

type Pet = { name: string; jenis: string; ras: string; kelamin: string; usia: string; since: string };

const PETS: Record<string, Pet[]> = {
  "C-001": [
    { name: "Rocky",    jenis: "Anjing",  ras: "Labrador",         kelamin: "Jantan", usia: "3 thn",       since: "12 Jan 2024" },
    { name: "Whiskers", jenis: "Kucing",  ras: "Persia",            kelamin: "Betina", usia: "2 thn",       since: "15 Mar 2024" },
    { name: "Tweety",   jenis: "Burung",  ras: "Lovebird",          kelamin: "Jantan", usia: "1 thn",       since: "05 Jun 2024" },
  ],
  "C-002": [
    { name: "Boni",     jenis: "Anjing",  ras: "Shih Tzu",          kelamin: "Jantan", usia: "2 thn 4 bln", since: "05 Mar 2024" },
    { name: "Luna",     jenis: "Kucing",  ras: "Domestik",          kelamin: "Betina", usia: "1 thn",       since: "10 Jul 2024" },
  ],
  "C-003": [
    { name: "Milo",     jenis: "Kucing",  ras: "British Shorthair", kelamin: "Jantan", usia: "2 thn 3 bln", since: "20 Nov 2023" },
    { name: "Max",      jenis: "Anjing",  ras: "Golden Retriever",  kelamin: "Jantan", usia: "3 thn 1 bln", since: "20 Nov 2023" },
    { name: "Luna",     jenis: "Kelinci", ras: "Holland Lop",       kelamin: "Betina", usia: "1 thn 6 bln", since: "05 Jan 2024" },
    { name: "Kiwi",     jenis: "Lainnya", ras: "Lovebird",          kelamin: "Jantan", usia: "8 bln",       since: "10 Feb 2024" },
  ],
  "C-004": [
    { name: "Coco",     jenis: "Kucing",  ras: "Domestik",          kelamin: "Betina", usia: "1 thn 2 bln", since: "02 Apr 2025" },
  ],
  "C-005": [
    { name: "Putih",    jenis: "Kelinci", ras: "Angora",            kelamin: "Betina", usia: "6 bln",       since: "18 Feb 2025" },
  ],
};

const TIER_CFG: Record<string, { label: string; bg: string; color: string }> = {
  bronze:   { label: "Bronze",   bg: "#fef3c7", color: "#92400e" },
  silver:   { label: "Silver",   bg: "#f3f4f6", color: "#374151" },
  gold:     { label: "Gold",     bg: "#fef9c3", color: "#713f12" },
  platinum: { label: "Platinum", bg: "#ede9fe", color: "#5b21b6" },
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span style={{ color: "var(--td)" }}>—</span>;
  const t = TIER_CFG[tier];
  return <span className="bge" style={{ background: t.bg, color: t.color }}>{t.label}</span>;
}

function MemberBadge({ v }: { v: string }) {
  const isM = v === "Member";
  return (
    <span className="bge" style={{ background: isM ? "#eff6ff" : "#f3f4f6", color: isM ? "#1d4ed8" : "#6b7280" }}>
      {v}
    </span>
  );
}

// Section header — dark navy number box + KAMO branding
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

function Donut({ size = 130 }: { size?: number }) {
  const cx = size / 2;
  const r  = cx * 0.76;
  const sw = r * 0.32;
  const C  = 2 * Math.PI * r;
  const m  = C * 0.623;
  const nm = C * 0.377;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f3f4f6" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#9ca3af" strokeWidth={sw}
          strokeDasharray={`${nm} ${m}`} strokeDashoffset={-m} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#16213e" strokeWidth={sw}
          strokeDasharray={`${m} ${nm}`} />
      </g>
      <text x={cx} y={cx - 5} textAnchor="middle" fontSize={size * 0.125} fontWeight={700} fill="#141413" fontFamily="system-ui,sans-serif">5.871</text>
      <text x={cx} y={cx + 9} textAnchor="middle" fontSize={size * 0.072} fill="#6b7280" fontFamily="system-ui,sans-serif">Total</text>
    </svg>
  );
}

function Av({ initials, color, size = 28 }: { initials: string; color: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.37, fontWeight: 600, color: "#fff", flexShrink: 0 }}>
      {initials}
    </div>
  );
}

export default function PelangganPage() {
  const [sel, setSel] = useState<Customer>(CUSTOMERS[2]);

  return (
    <>
      {/* Back nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Data Pelanggan</span>
      </div>

      {/* ── Section 01 + 02 side by side ─────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

        {/* ── Section 01: Stats ─── */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DATA PELANGGAN"
            desc="Ringkasan data pelanggan berdasarkan kategori dan keanggotaan." />

          {/* Tier cards — 4-col compact */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginBottom: 12 }}>
            {TIERS.map(t => (
              <div key={t.key} style={{ background: t.bg, border: `.5px solid ${t.bd}`, borderRadius: 8, padding: "10px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
                  <i className={`ti ${t.icon}`} style={{ color: t.color, fontSize: 15 }} />
                  <span style={{ fontSize: 8, fontWeight: 700, color: t.color, letterSpacing: ".05em" }}>{t.label}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#141413", lineHeight: 1 }}>{fmt(t.count)}</div>
                <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>Pelanggan</div>
                <div style={{ fontSize: 9.5, color: t.color, marginTop: 2, fontWeight: 600 }}>{t.pct}</div>
              </div>
            ))}
          </div>

          {/* Kategori Keanggotaan + Distribusi */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {/* Keanggotaan */}
            <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "12px 10px" }}>
              <div style={{ fontSize: 8.5, fontWeight: 600, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 11 }}>KATEGORI KEANGGOTAAN</div>
              {[
                { icon: "ti-user", iconColor: "#2563eb", iconBg: "#eff6ff", label: "MEMBER", count: "3.654", pct: "62,3%", pctColor: "#2563eb" },
                { icon: "ti-user", iconColor: "#9ca3af", iconBg: "#f3f4f6", label: "NON MEMBER", count: "2.217", pct: "37,7%", pctColor: "#6b7280" },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: row.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`ti ${row.icon}`} style={{ color: row.iconColor, fontSize: 15 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 8.5, fontWeight: 700, color: row.pctColor, letterSpacing: ".04em" }}>{row.label}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#141413", lineHeight: 1.1 }}>{row.count}</div>
                    <div style={{ fontSize: 8.5, color: "var(--tm)" }}>Pelanggan</div>
                    <div style={{ fontSize: 10, color: row.pctColor, fontWeight: 600 }}>{row.pct}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Donut + Legend */}
            <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "12px 10px" }}>
              <div style={{ fontSize: 8.5, fontWeight: 600, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 8 }}>DISTRIBUSI PELANGGAN</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <Donut size={110} />
                <div style={{ width: "100%" }}>
                  {[
                    { bg: "#fef3c7", bd: "#fde68a", tc: "#92400e", label: "Bronze (21,4%)"      },
                    { bg: "#f3f4f6", bd: "#e5e7eb", tc: "#4b5563", label: "Silver (16,7%)"       },
                    { bg: "#fef9c3", bd: "#fef08a", tc: "#713f12", label: "Gold (19,5%)"         },
                    { bg: "#ede9fe", bd: "#ddd6fe", tc: "#5b21b6", label: "Platinum (10,5%)"     },
                    { bg: "#f3f4f6", bd: "#e5e7eb", tc: "#6b7280", label: "Non Member (37,7%)"   },
                  ].map(l => (
                    <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                      <div style={{ width: 9, height: 9, borderRadius: 2, background: l.bg, border: `.5px solid ${l.bd}`, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, color: l.tc }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 8.5, color: "var(--td)", marginTop: 10 }}>*Data per 25 Jun 2026</div>
        </div>

        {/* ── Section 02: Customer List ─── */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="DAFTAR PELANGGAN"
            desc="Data pelanggan berdasarkan kategori dan keanggotaan." />

          {/* Filter bar — 2x2 grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--tm)", marginBottom: 2 }}>Kategori</div>
              <select className="fi" style={{ fontSize: 11 }}>
                <option>Semua</option><option>Bronze</option><option>Silver</option><option>Gold</option><option>Platinum</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--tm)", marginBottom: 2 }}>Keanggotaan</div>
              <select className="fi" style={{ fontSize: 11 }}>
                <option>Semua</option><option>Member</option><option>Non Member</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--tm)", marginBottom: 2 }}>Cabang</div>
              <select className="fi" style={{ fontSize: 11 }}>
                <option>Semua</option><option>VET CMGG</option><option>VET TKI</option><option>BTKM</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: "var(--tm)", marginBottom: 2 }}>&nbsp;</div>
              <div style={{ position: "relative" }}>
                <input className="fi" placeholder="Cari pelanggan..." style={{ fontSize: 11, paddingRight: 26 }} />
                <i className="ti ti-search" style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 11, pointerEvents: "none" }} />
              </div>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 500 }}>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Nama Pelanggan</th>
                  <th>Keanggotaan</th>
                  <th>Kategori</th>
                  <th style={{ textAlign: "right" }}>Total Transaksi</th>
                  <th style={{ textAlign: "right" }}>Total Pembelian</th>
                  <th style={{ textAlign: "center" }}>Anabul</th>
                  <th>Terdaftar Sejak</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {CUSTOMERS.map((c, i) => (
                  <tr key={c.id}
                    style={{ cursor: "pointer", background: sel.id === c.id ? "rgba(217,119,87,.06)" : undefined, transition: "background .1s" }}
                    onClick={() => setSel(c)}
                  >
                    <td style={{ color: "var(--td)", fontSize: 11 }}>{i + 1}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Av initials={c.initials} color={c.color} size={25} />
                        <span style={{ fontWeight: 500, fontSize: 11.5 }}>{c.name}</span>
                      </div>
                    </td>
                    <td><MemberBadge v={c.membership} /></td>
                    <td><TierBadge tier={c.tier} /></td>
                    <td style={{ textAlign: "right", fontWeight: 500 }}>{c.transaksi}</td>
                    <td style={{ textAlign: "right", fontWeight: 500, fontSize: 11 }}>{rp(c.total)}</td>
                    <td style={{ textAlign: "center" }}>{c.anabul}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{c.since}</td>
                    <td>
                      <button className="back-btn" title="Lihat detail"
                        onClick={e => { e.stopPropagation(); setSel(c); }}>
                        <i className="ti ti-eye" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <span style={{ fontSize: 10, color: "var(--tm)" }}>Menampilkan 1 - 5 dari 5.871 pelanggan</span>
            <div style={{ display: "flex", gap: 3 }}>
              {["‹", "1", "2", "3", "...", "1175", "›"].map((p, i) => (
                <button key={i} style={{
                  padding: "2px 6px", fontSize: 10, border: ".5px solid var(--bd)", borderRadius: 4, cursor: "pointer",
                  background: p === "1" ? "var(--sb)" : "#fff",
                  color:      p === "1" ? "#fff"       : "var(--tm)",
                }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 03: Pets (full width) ───────────────────────── */}
      <div className="crm-sec">
        <SecHeader num="03" title="DATA ANABUL PELANGGAN"
          desc="Rincian data hewan peliharaan (anabul) yang terdaftar pada setiap pelanggan." />

        <div className="grid2" style={{ alignItems: "start" }}>
          {/* Customer detail panel */}
          <div style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: ".5px solid var(--bd)" }}>
              <Av initials={sel.initials} color={sel.color} size={40} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{sel.name}</div>
                <div style={{ marginTop: 4 }}><TierBadge tier={sel.tier} /></div>
              </div>
              <div style={{ fontSize: 9.5, color: "var(--td)", textAlign: "right" }}>
                Member sejak<br />{sel.since}
              </div>
            </div>

            {([
              { icon: "ti-phone",        label: "No. Handphone",  val: sel.phone },
              { icon: "ti-mail",         label: "Email",          val: sel.email },
              { icon: "ti-shopping-bag", label: "Total Transaksi",val: `${sel.transaksi} Transaksi` },
              { icon: "ti-cash",         label: "Total Pembelian",val: rp(sel.total) },
              { icon: "ti-star",         label: "Poin Reward",    val: `${fmt(sel.points)} Poin` },
            ] as const).map(row => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: ".5px solid var(--bd)" }}>
                <i className={`ti ${row.icon}`} style={{ color: "var(--tm)", fontSize: 14, width: 18, textAlign: "center" }} />
                <span style={{ fontSize: 11, color: "var(--tm)", flex: 1 }}>{row.label}</span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{row.val}</span>
              </div>
            ))}

            <div style={{ fontSize: 9, color: "var(--td)", marginTop: 9 }}>*Data per 25 Jun 2026</div>
          </div>

          {/* Pets table */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 12, letterSpacing: ".03em" }}>DAFTAR ANABUL</span>
              <button className="btn-acc" style={{ fontSize: 11 }}>+ Tambah Anabul</button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Nama Anabul</th>
                    <th>Jenis</th>
                    <th>Ras</th>
                    <th>Jenis Kelamin</th>
                    <th>Usia</th>
                    <th>Status</th>
                    <th>Terdaftar Sejak</th>
                    <th>Foto</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {(PETS[sel.id] ?? []).map((p, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--td)", fontSize: 11 }}>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td style={{ color: "var(--tm)" }}>{p.jenis}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{p.ras}</td>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: p.kelamin === "Jantan" ? "#2563eb" : "#db2777" }}>
                          <i className={`ti ti-gender-${p.kelamin === "Jantan" ? "male" : "female"}`} style={{ fontSize: 13 }} />
                          {p.kelamin}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{p.usia}</td>
                      <td><span className="bge g">Aktif</span></td>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{p.since}</td>
                      <td>
                        <div style={{ width: 28, height: 28, borderRadius: 5, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", border: ".5px solid var(--bd)" }}>
                          <i className="ti ti-photo" style={{ color: "var(--td)", fontSize: 12 }} />
                        </div>
                      </td>
                      <td>
                        <button className="back-btn"><i className="ti ti-dots" /></button>
                      </td>
                    </tr>
                  ))}
                  {(PETS[sel.id] ?? []).length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>
                        Belum ada anabul terdaftar
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
