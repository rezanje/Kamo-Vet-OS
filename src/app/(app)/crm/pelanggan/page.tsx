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
  { id: "C-001", name: "Dewi Sandra",   initials: "DS", color: "#7c3aed", membership: "Member",     tier: "gold",     transaksi: 28, total: 7850000,  anabul: 3, since: "12 Jan 2024", phone: "0812-9876-5432", email: "dewi.s@gmail.com",         points: 7850  },
  { id: "C-002", name: "Andi Rahman",   initials: "AR", color: "#2563eb", membership: "Member",     tier: "silver",   transaksi: 15, total: 3250000,  anabul: 2, since: "05 Mar 2024", phone: "0857-1234-5678", email: "andi.r@gmail.com",         points: 3250  },
  { id: "C-003", name: "Maria Cahyani", initials: "MC", color: "#d97757", membership: "Member",     tier: "platinum", transaksi: 42, total: 12400000, anabul: 4, since: "20 Nov 2023", phone: "0812-3456-7890", email: "maria.cahyani@email.com",  points: 12560 },
  { id: "C-004", name: "Budi Santoso",  initials: "BS", color: "#6b7280", membership: "Non Member", tier: null,       transaksi: 6,  total: 980000,   anabul: 1, since: "02 Apr 2025", phone: "0878-5555-4444", email: "budi.s@yahoo.com",         points: 0     },
  { id: "C-005", name: "Nadia Tania",   initials: "NT", color: "#16a34a", membership: "Member",     tier: "bronze",   transaksi: 9,  total: 1560000,  anabul: 1, since: "18 Feb 2025", phone: "0821-9999-8888", email: "nadia.t@gmail.com",        points: 1560  },
];

type Pet = { name: string; jenis: string; ras: string; kelamin: string; usia: string; since: string };

const PETS: Record<string, Pet[]> = {
  "C-001": [
    { name: "Rocky",    jenis: "Anjing",  ras: "Labrador",          kelamin: "Jantan", usia: "3 thn",       since: "12 Jan 2024" },
    { name: "Whiskers", jenis: "Kucing",  ras: "Persia",             kelamin: "Betina", usia: "2 thn",       since: "15 Mar 2024" },
    { name: "Tweety",   jenis: "Burung",  ras: "Lovebird",           kelamin: "Jantan", usia: "1 thn",       since: "05 Jun 2024" },
  ],
  "C-002": [
    { name: "Boni",     jenis: "Anjing",  ras: "Shih Tzu",           kelamin: "Jantan", usia: "2 thn 4 bln", since: "05 Mar 2024" },
    { name: "Luna",     jenis: "Kucing",  ras: "Domestik",           kelamin: "Betina", usia: "1 thn",       since: "10 Jul 2024" },
  ],
  "C-003": [
    { name: "Milo",     jenis: "Kucing",  ras: "British Shorthair",  kelamin: "Jantan", usia: "2 thn 3 bln", since: "20 Nov 2023" },
    { name: "Max",      jenis: "Anjing",  ras: "Golden Retriever",   kelamin: "Jantan", usia: "3 thn 1 bln", since: "20 Nov 2023" },
    { name: "Luna",     jenis: "Kelinci", ras: "Holland Lop",        kelamin: "Betina", usia: "1 thn 6 bln", since: "05 Jan 2024" },
    { name: "Kiwi",     jenis: "Lainnya", ras: "Lovebird",           kelamin: "Jantan", usia: "8 bln",       since: "10 Feb 2024" },
  ],
  "C-004": [
    { name: "Coco",     jenis: "Kucing",  ras: "Domestik",           kelamin: "Betina", usia: "1 thn 2 bln", since: "02 Apr 2025" },
  ],
  "C-005": [
    { name: "Putih",    jenis: "Kelinci", ras: "Angora",             kelamin: "Betina", usia: "6 bln",       since: "18 Feb 2025" },
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

function SecHeader({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: ".5px solid var(--bd)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 38, fontWeight: 900, color: "#e5e7eb", lineHeight: 1, flexShrink: 0 }}>{num}</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)", letterSpacing: ".01em" }}>{title}</div>
          <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 2 }}>{desc}</div>
        </div>
      </div>
      {/* KAMO branding */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--sb)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="ti ti-paw" style={{ color: "#fff", fontSize: 12 }} />
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", letterSpacing: ".08em" }}>KAMO</div>
          <div style={{ fontSize: 7.5, color: "#9ca3af", letterSpacing: ".06em" }}>PET CARE</div>
        </div>
      </div>
    </div>
  );
}

function Donut() {
  const r  = 55;
  const sw = 18;
  const C  = 2 * Math.PI * r;       // ≈ 345.6
  const m  = C * 0.623;              // member arc ≈ 215.3
  const nm = C * 0.377;              // non-member arc ≈ 130.3

  return (
    <svg width={150} height={150} viewBox="0 0 150 150" style={{ flexShrink: 0 }}>
      <g transform="rotate(-90 75 75)">
        <circle cx={75} cy={75} r={r} fill="none" stroke="#f3f4f6" strokeWidth={sw} />
        {/* non-member (gray) — starts after member arc */}
        <circle cx={75} cy={75} r={r} fill="none" stroke="#9ca3af" strokeWidth={sw}
          strokeDasharray={`${nm} ${m}`}
          strokeDashoffset={-m}
        />
        {/* member (navy) — starts at 12 o'clock */}
        <circle cx={75} cy={75} r={r} fill="none" stroke="#16213e" strokeWidth={sw}
          strokeDasharray={`${m} ${nm}`}
        />
      </g>
      <text x={75} y={69} textAnchor="middle" fontSize={19} fontWeight={700} fill="#141413" fontFamily="system-ui,sans-serif">5.871</text>
      <text x={75} y={84} textAnchor="middle" fontSize={9} fill="#6b7280" fontFamily="system-ui,sans-serif">Total</text>
    </svg>
  );
}

const AV_COLORS = ["#7c3aed","#2563eb","#16a34a","#d97706","#db2777","#0891b2","#059669","#9333ea"];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AV_COLORS.length;
  return AV_COLORS[h];
}

function Av({ initials, color, size = 28 }: { initials: string; color?: string; size?: number }) {
  const bg = color ?? avatarColor(initials);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.37, fontWeight: 600, color: "#fff", flexShrink: 0 }}>
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

      {/* ── Section 01: Stats ──────────────────────────────────── */}
      <div className="crm-sec">
        <SecHeader num="01" title="DATA PELANGGAN"
          desc="Ringkasan data pelanggan berdasarkan kategori dan keanggotaan." />

        {/* Tier stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
          {TIERS.map(t => (
            <div key={t.key} style={{ background: t.bg, border: `.5px solid ${t.bd}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <i className={`ti ${t.icon}`} style={{ color: t.color, fontSize: 17 }} />
                <span style={{ fontSize: 9.5, fontWeight: 700, color: t.color, letterSpacing: ".06em" }}>{t.label}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#141413", lineHeight: 1 }}>{fmt(t.count)}</div>
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3 }}>Pelanggan</div>
              <div style={{ fontSize: 10.5, color: t.color, marginTop: 3, fontWeight: 600 }}>{t.pct}</div>
            </div>
          ))}
        </div>

        {/* Member split + donut */}
        <div className="grid2">
          <div style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: "14px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 14 }}>KATEGORI KEANGGOTAAN</div>
            <div style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16213e" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", letterSpacing: ".04em" }}>MEMBER</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#141413", lineHeight: 1 }}>3.654</div>
                <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 3 }}>Pelanggan</div>
                <div style={{ fontSize: 11.5, color: "#1d4ed8", fontWeight: 600, marginTop: 4 }}>62,3%</div>
              </div>
              <div style={{ width: ".5px", background: "var(--bd)", alignSelf: "stretch" }} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#9ca3af" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em" }}>NON MEMBER</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#141413", lineHeight: 1 }}>2.217</div>
                <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 3 }}>Pelanggan</div>
                <div style={{ fontSize: 11.5, color: "var(--tm)", fontWeight: 500, marginTop: 4 }}>37,7%</div>
              </div>
            </div>
          </div>

          <div style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: "14px", display: "flex", alignItems: "center", gap: 14 }}>
            <Donut />
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 10 }}>DISTRIBUSI PELANGGAN</div>
              {[
                { bg: "#fef3c7", bd: "#fde68a", c: "#92400e", label: "Bronze (21,4%)" },
                { bg: "#f3f4f6", bd: "#e5e7eb", c: "#4b5563", label: "Silver (16,7%)"  },
                { bg: "#fef9c3", bd: "#fef08a", c: "#713f12", label: "Gold (19,5%)"    },
                { bg: "#ede9fe", bd: "#ddd6fe", c: "#5b21b6", label: "Platinum (10,5%)"},
                { bg: "#f3f4f6", bd: "#e5e7eb", c: "#6b7280", label: "Non Member (37,7%)"},
              ].map(l => (
                <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: l.bg, border: `.5px solid ${l.bd}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: l.c }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 9, color: "var(--td)", marginTop: 10 }}>*Data per 25 Jun 2026</div>
      </div>

      {/* ── Section 02: Customer List ──────────────────────────── */}
      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR PELANGGAN"
          desc="Data pelanggan berdasarkan kategori dan keanggotaan." />

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 9.5, color: "var(--tm)", marginBottom: 3 }}>Kategori</div>
            <select className="fi" style={{ width: 110 }}>
              <option>Semua</option><option>Bronze</option><option>Silver</option><option>Gold</option><option>Platinum</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: "var(--tm)", marginBottom: 3 }}>Keanggotaan</div>
            <select className="fi" style={{ width: 120 }}>
              <option>Semua</option><option>Member</option><option>Non Member</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: "var(--tm)", marginBottom: 3 }}>Cabang</div>
            <select className="fi" style={{ width: 120 }}>
              <option>Semua</option><option>VET CMGG</option><option>VET TKI</option><option>BTKM</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 9.5, color: "var(--tm)", marginBottom: 3 }}>&nbsp;</div>
            <div style={{ position: "relative" }}>
              <input className="fi" placeholder="Cari pelanggan..." style={{ paddingRight: 28 }} />
              <i className="ti ti-search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 12, pointerEvents: "none" }} />
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 680 }}>
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Av initials={c.initials} color={c.color} size={28} />
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                  </div>
                </td>
                <td><MemberBadge v={c.membership} /></td>
                <td><TierBadge tier={c.tier} /></td>
                <td style={{ textAlign: "right", fontWeight: 500 }}>{c.transaksi}</td>
                <td style={{ textAlign: "right", fontWeight: 500, fontSize: 11.5 }}>{rp(c.total)}</td>
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
        </div>{/* /overflow wrapper */}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Menampilkan 1 - 5 dari 5.871 pelanggan</span>
          <div style={{ display: "flex", gap: 3 }}>
            {["‹", "1", "2", "3", "...", "1175", "›"].map((p, i) => (
              <button key={i} style={{
                padding: "3px 7px", fontSize: 10.5, border: ".5px solid var(--bd)", borderRadius: 5, cursor: "pointer",
                background: p === "1" ? "var(--sb)" : "#fff",
                color:      p === "1" ? "#fff"       : "var(--tm)",
              }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section 03: Pets ──────────────────────────────────── */}
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
              { icon: "ti-phone",       label: "No. Handphone",  val: sel.phone },
              { icon: "ti-mail",        label: "Email",          val: sel.email },
              { icon: "ti-shopping-bag",label: "Total Transaksi",val: `${sel.transaksi} Transaksi` },
              { icon: "ti-cash",        label: "Total Pembelian",val: rp(sel.total) },
              { icon: "ti-star",        label: "Poin Reward",    val: `${fmt(sel.points)} Poin` },
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
                  <th>Nama</th>
                  <th>Jenis</th>
                  <th>Ras</th>
                  <th>Kelamin</th>
                  <th>Usia</th>
                  <th>Status</th>
                  <th>Terdaftar</th>
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
                      <button className="back-btn"><i className="ti ti-dots" /></button>
                    </td>
                  </tr>
                ))}
                {(PETS[sel.id] ?? []).length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>
                      Belum ada anabul terdaftar
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>{/* /overflow wrapper */}
          </div>
        </div>
      </div>
    </>
  );
}
