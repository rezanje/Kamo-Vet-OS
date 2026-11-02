import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { allowedBranchIds } from "@/lib/branch-access";
import { rincianPembayaran } from "@/lib/rincian-tutup-shift";
import { geserHari, hariIniWIB } from "@/lib/tanggal";
import { readCompleteList } from "@/lib/checked-list";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const rp = (n: number) => (n < 0 ? "− " : "") + "Rp " + Math.round(Math.abs(n)).toLocaleString("id-ID");
const fmtDt = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";
const tanggalSah = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

const PER_HALAMAN = 30;

// Riwayat Tutup Shift — atasan membuka lagi laporan tutup shift kapan saja, tanpa
// bergantung pada foto di grup WhatsApp (permintaan pemilik toko, 2 Nov 2026).
export default async function RiwayatTutupShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ cabang?: string; jenis?: string; dari?: string; sampai?: string; hal?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const hariIni = hariIniWIB();
  const dari = tanggalSah(sp.dari) ?? `${hariIni.slice(0, 7)}-01`;
  const sampai = tanggalSah(sp.sampai) ?? hariIni;
  const jenis = sp.jenis === "petshop" || sp.jenis === "klinik" ? sp.jenis : "";
  const hal = Math.max(1, Number.parseInt(sp.hal ?? "1", 10) || 1);

  const [izin, { data: cabangData }] = await Promise.all([
    user ? allowedBranchIds(supabase, user.id) : Promise.resolve([] as string[]),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const semuaCabang = (cabangData ?? []) as { id: string; name: string }[];
  const cabangBoleh = izin === null ? semuaCabang : semuaCabang.filter((c) => izin.includes(c.id));
  const cabang = cabangBoleh.some((c) => c.id === sp.cabang) ? sp.cabang! : "";

  let rows: {
    id: string; shift_type: string; closing_balance: number | null; expected_cash: number | null; selisih: number | null;
    closing_breakdown: Record<string, number> | null; opened_at: string; closed_at: string | null;
    branches: Rel<{ name: string }>; profiles: Rel<{ full_name: string | null }>;
  }[] = [];
  let total = 0;

  const cabangDicari = cabang ? [cabang] : izin === null ? null : cabangBoleh.map((c) => c.id);
  if (cabangDicari === null || cabangDicari.length > 0) {
    let q = supabase
      .from("cashier_shifts")
      .select("id, shift_type, closing_balance, expected_cash, selisih, closing_breakdown, opened_at, closed_at, branches(name), profiles(full_name)", { count: "exact" })
      .eq("status", "closed")
      .gte("closed_at", `${dari}T00:00:00+07:00`)
      .lt("closed_at", `${geserHari(sampai, 1)}T00:00:00+07:00`);
    if (cabangDicari) q = q.in("branch_id", cabangDicari);
    if (jenis) q = q.eq("shift_type", jenis);
    const awal = (hal - 1) * PER_HALAMAN;
    const { data, count, error } = await q.order("closed_at", { ascending: false }).range(awal, awal + PER_HALAMAN - 1);
    if (error) throw new Error("Riwayat tutup shift belum dapat dibaca. Muat ulang halaman ini.");
    rows = (data ?? []) as typeof rows;
    total = count ?? rows.length;
  }

  // Rekap closing per cabang untuk SELURUH rentang (bukan hanya halaman ini) — permintaan Anisa
  // 2 Nov: "menampilkan hasil closing semua cabang klinik dan petshop" dalam satu layar.
  type BarisRekap = { cabang: string; jenis: string; shift: number; omset: number; tunai: number; nonTunai: number; selisih: number };
  let rekap: BarisRekap[] = [];
  let rekapGagal = false;
  if (total > 0) {
    try {
      type Src = { id: string; shift_type: string; selisih: number | null; closing_breakdown: Record<string, number> | null; branch_id: string };
      const semua = await readCompleteList<Src>((from, to) => {
        let q = supabase.from("cashier_shifts")
          .select("id, shift_type, selisih, closing_breakdown, branch_id", { count: "exact" })
          .eq("status", "closed")
          .gte("closed_at", `${dari}T00:00:00+07:00`)
          .lt("closed_at", `${geserHari(sampai, 1)}T00:00:00+07:00`);
        if (cabangDicari) q = q.in("branch_id", cabangDicari);
        if (jenis) q = q.eq("shift_type", jenis);
        return q.order("id").range(from, to);
      }, "Rekap tutup shift");
      const namaCabang = new Map(semuaCabang.map((c) => [c.id, c.name]));
      const peta = new Map<string, BarisRekap>();
      for (const h of semua) {
        const kunci = `${h.branch_id}|${h.shift_type}`;
        const b = peta.get(kunci) ?? { cabang: namaCabang.get(h.branch_id) ?? "—", jenis: h.shift_type, shift: 0, omset: 0, tunai: 0, nonTunai: 0, selisih: 0 };
        const r = rincianPembayaran(h.closing_breakdown);
        b.shift += 1; b.omset += r.omset; b.tunai += r.tunai; b.nonTunai += r.nonTunai; b.selisih += Number(h.selisih ?? 0);
        peta.set(kunci, b);
      }
      rekap = [...peta.values()].sort((a, b) => a.jenis.localeCompare(b.jenis) || a.cabang.localeCompare(b.cabang));
    } catch {
      rekapGagal = true;
    }
  }
  const totalRekap = rekap.reduce((a, r) => ({ shift: a.shift + r.shift, omset: a.omset + r.omset, tunai: a.tunai + r.tunai, nonTunai: a.nonTunai + r.nonTunai, selisih: a.selisih + r.selisih }),
    { shift: 0, omset: 0, tunai: 0, nonTunai: 0, selisih: 0 });
  const warnaSelisih = (n: number) => (Math.round(n) === 0 ? "#15803d" : n > 0 ? "#1d4ed8" : "#b91c1c");

  const jumlahHal = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const urlHal = (n: number) => {
    const p = new URLSearchParams();
    if (cabang) p.set("cabang", cabang);
    if (jenis) p.set("jenis", jenis);
    p.set("dari", dari);
    p.set("sampai", sampai);
    p.set("hal", String(n));
    return `/pos/shift/riwayat?${p.toString()}`;
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/shift" className="back-btn"><i className="ti ti-arrow-left" /> Shift Kasir</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Riwayat Tutup Shift</span>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="RIWAYAT TUTUP SHIFT" desc="Semua laporan tutup shift kasir. Klik Buka untuk melihat rinciannya — sama dengan layar yang difoto kasir." />

        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang} style={{ minWidth: 160 }}>
              <option value="">Semua cabang</option>
              {cabangBoleh.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="flab">Jenis</label>
            <select className="fi" name="jenis" defaultValue={jenis}>
              <option value="">Petshop &amp; klinik</option>
              <option value="petshop">Petshop</option>
              <option value="klinik">Klinik</option>
            </select>
          </div>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <button type="submit" className="btn-acc"><i className="ti ti-search" /> Tampilkan</button>
        </form>

        {rekapGagal && (
          <div className="p2ban" role="alert">Rekap per cabang belum dapat dihitung lengkap. Daftar shift di bawah tetap bisa dibuka; muat ulang untuk mencoba lagi.</div>
        )}
        {rekap.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--posb)", marginBottom: 6 }}>
              REKAP CLOSING PER CABANG · {dari === sampai ? dari : `${dari} s/d ${sampai}`}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" aria-label="Rekap closing per cabang" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th>Cabang</th><th>Jenis</th><th style={{ textAlign: "right" }}>Shift</th>
                    <th style={{ textAlign: "right" }}>Omset</th><th style={{ textAlign: "right" }}>Tunai</th>
                    <th style={{ textAlign: "right" }}>Non-tunai</th><th style={{ textAlign: "right" }}>Selisih kas</th>
                  </tr>
                </thead>
                <tbody>
                  {rekap.map((r) => (
                    <tr key={`${r.cabang}|${r.jenis}`}>
                      <td style={{ fontSize: 11 }}>{r.cabang}</td>
                      <td style={{ fontSize: 11 }}><span className={`bge ${r.jenis === "klinik" ? "b" : "g"}`}>{r.jenis}</span></td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{r.shift}</td>
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(r.omset)}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.tunai)}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.nonTunai)}</td>
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: warnaSelisih(r.selisih) }}>{r.selisih > 0 ? "+ " : ""}{rp(r.selisih)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 800 }}>
                    <td style={{ fontSize: 11 }} colSpan={2}>Total semua cabang</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{totalRekap.shift}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(totalRekap.omset)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(totalRekap.tunai)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(totalRekap.nonTunai)}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: warnaSelisih(totalRekap.selisih) }}>{totalRekap.selisih > 0 ? "+ " : ""}{rp(totalRekap.selisih)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 4 }}>Omset = rekap metode bayar yang dikunci saat shift ditutup (sama dengan laporan tutup shift). Rincian per shift ada di daftar bawah.</div>
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" aria-label="Daftar tutup shift" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Ditutup</th><th>Cabang</th><th>Kasir</th><th>Jenis</th>
                <th style={{ textAlign: "right" }}>Omset</th>
                <th style={{ textAlign: "right" }}>Kas seharusnya</th>
                <th style={{ textAlign: "right" }}>Kas fisik</th>
                <th style={{ textAlign: "right" }}>Selisih</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const sel = Number(h.selisih ?? 0);
                return (
                  <tr key={h.id}>
                    <td style={{ fontSize: 11, color: "var(--tm)", whiteSpace: "nowrap" }}>{fmtDt(h.closed_at)}</td>
                    <td style={{ fontSize: 11 }}>{one(h.branches)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{one(h.profiles)?.full_name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}><span className={`bge ${h.shift_type === "klinik" ? "b" : "g"}`}>{h.shift_type}</span></td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(rincianPembayaran(h.closing_breakdown).omset)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(h.expected_cash ?? 0))}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(h.closing_balance ?? 0))}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: sel === 0 ? "#15803d" : sel > 0 ? "#1d4ed8" : "#b91c1c" }}>
                      {sel > 0 ? "+ " : ""}{rp(sel)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/pos/shift/${h.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none", whiteSpace: "nowrap" }}>
                        <i className="ti ti-file-text" /> Buka
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Belum ada shift yang ditutup di rentang ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 11, color: "var(--tm)", flexWrap: "wrap", gap: 8 }}>
            <span>{total.toLocaleString("id-ID")} shift · halaman {hal} dari {jumlahHal}</span>
            <span style={{ display: "flex", gap: 6 }}>
              {hal > 1 && <Link href={urlHal(hal - 1)} className="btn-def" style={{ fontSize: 10.5, textDecoration: "none" }}><i className="ti ti-chevron-left" /> Sebelumnya</Link>}
              {hal < jumlahHal && <Link href={urlHal(hal + 1)} className="btn-def" style={{ fontSize: 10.5, textDecoration: "none" }}>Berikutnya <i className="ti ti-chevron-right" /></Link>}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
