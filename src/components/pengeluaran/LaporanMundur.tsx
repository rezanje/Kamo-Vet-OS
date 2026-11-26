import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { hariIniWIB } from "@/lib/tanggal";
import { formatTanggalID, geserTanggalISO, tanggalSah } from "@/lib/tanggal-mundur";
import { lintasBulan, ringkasLaporanMundur, selisihHari, tanggalInputWIB } from "@/lib/expense-jejak";

/**
 * Laporan pengeluaran bertanggal mundur (review PR #570, MINOR-4): satu tempat untuk Finance melihat semua pengeluaran yang
 * dicatat dengan tanggal lampau pada periode INPUT tertentu: siapa, kapan diinput, tanggal efektif, alasan, dan mana yang
 * jatuh di bulan lain (laporan bulan itu berubah setelah dilaporkan). Sumber: expense_backdates (tak dapat diubah), tunduk RLS.
 */
type Jejak = { expense_id: string; actor_id: string; branch_id: string; context: string; effective_date: string; reason: string; recorded_at: string; kategori: string; jumlah: number };
type Kini = { id: string; tanggal: string; jumlah: number; voided_at: string | null };
const BATAS_BARIS = 500;
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const waktu = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const KONTEKS: Record<string, string> = { cashier: "Kasir petshop", clinic: "Klinik", backoffice: "Back office" };

async function dalamPotongan<T>(ids: string[], muat: (potong: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await muat(ids.slice(i, i + 100));
    if (!error && Array.isArray(data)) out.push(...(data as T[]));
  }
  return out;
}

export async function LaporanMundur({ dari, sampai, aksi }: { dari?: string; sampai?: string; aksi: string }) {
  const today = hariIniWIB();
  let awal = dari && tanggalSah(dari) ? dari : `${today.slice(0, 7)}-01`;
  let akhir = sampai && tanggalSah(sampai) ? sampai : today;
  if (awal > akhir) [awal, akhir] = [akhir, awal];

  const supabase = await createClient();
  let rows: Jejak[] = [];
  let gagal = false;
  try {
    const { data, error } = await supabase.from("expense_backdates")
      .select("expense_id, actor_id, branch_id, context, effective_date, reason, recorded_at, kategori, jumlah")
      .gte("recorded_at", `${awal}T00:00:00+07:00`).lt("recorded_at", `${geserTanggalISO(akhir, 1)}T00:00:00+07:00`)
      .order("recorded_at", { ascending: false }).limit(BATAS_BARIS + 1);
    if (error || !Array.isArray(data)) gagal = true; else rows = data as Jejak[];
  } catch { gagal = true; }
  const terpotong = rows.length > BATAS_BARIS;
  if (terpotong) rows = rows.slice(0, BATAS_BARIS);

  // Nama cabang/pelaku dan keadaan pengeluaran sekarang (dibatalkan / tanggal diubah). Gagal baca hanya mengosongkan kolomnya.
  const nama = { cabang: new Map<string, string>(), pelaku: new Map<string, string>() };
  const kini = new Map<string, Kini>();
  if (rows.length) try {
    const [cabang, pelaku, sekarang] = await Promise.all([
      dalamPotongan<{ id: string; name: string }>([...new Set(rows.map((r) => r.branch_id))], (p) => supabase.from("branches").select("id, name").in("id", p)),
      dalamPotongan<{ id: string; full_name: string | null }>([...new Set(rows.map((r) => r.actor_id))], (p) => supabase.from("profiles").select("id, full_name").in("id", p)),
      dalamPotongan<Kini>(rows.map((r) => r.expense_id), (p) => supabase.from("expenses").select("id, tanggal, jumlah, voided_at").in("id", p)),
    ]);
    for (const c of cabang) nama.cabang.set(c.id, c.name);
    for (const p of pelaku) if (p.full_name) nama.pelaku.set(p.id, p.full_name);
    for (const e of sekarang) kini.set(e.id, e);
  } catch { /* kolom nama saja yang kosong */ }

  // Nominal yang dipakai = nominal SEKARANG (bisa dikoreksi); yang dibatalkan memakai nominal aslinya hanya untuk tampilan.
  const nominal = (r: Jejak) => { const k = kini.get(r.expense_id); return k && !k.voided_at ? Number(k.jumlah) : Number(r.jumlah); };
  const ringkas = ringkasLaporanMundur(rows.map((r) => ({ effective_date: r.effective_date, recorded_at: r.recorded_at, jumlah: nominal(r), dibatalkan: !!kini.get(r.expense_id)?.voided_at })));

  return (
    <div className="crm-sec" data-testid="laporan-mundur">
      <SecHeader num="03" title="LAPORAN PENGELUARAN TANGGAL MUNDUR" desc="Pengeluaran yang dicatat dengan tanggal lampau, menurut tanggal INPUT. Alasan dan waktu input tidak dapat diubah." />
      <form method="GET" action={aksi} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginBottom: 10 }}>
        <div><label className="flab" htmlFor="mdari">Diinput dari</label><input id="mdari" className="fi" type="date" name="mdari" defaultValue={awal} max={today} /></div>
        <div><label className="flab" htmlFor="msampai">Sampai</label><input id="msampai" className="fi" type="date" name="msampai" defaultValue={akhir} max={today} /></div>
        <button type="submit" className="btn-def">Tampilkan</button>
      </form>
      {gagal && <div className="p2ban" role="alert">Laporan tanggal mundur belum dapat dimuat. Muat ulang halaman.</div>}
      {!gagal && (
        <>
          <div style={{ fontSize: 11.5, marginBottom: 8 }} data-testid="ringkasan-mundur">
            {formatTanggalID(awal)} s/d {formatTanggalID(akhir)}: <b>{ringkas.baris}</b> pengeluaran mundur, total <b>{rp(ringkas.total)}</b>
            {ringkas.dibatalkan > 0 && <> ({ringkas.dibatalkan} sudah dibatalkan, tidak dihitung)</>}.
            {ringkas.lintasBulan > 0 && <> <b>{ringkas.lintasBulan}</b> di antaranya ({rp(ringkas.totalLintasBulan)}) jatuh di bulan yang berbeda dari bulan input: laporan bulan itu berubah.</>}
          </div>
          {terpotong && <div className="p2ban" role="status">Hanya {BATAS_BARIS} baris terbaru yang ditampilkan. Persempit periode input.</div>}
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 860 }}>
              <thead><tr><th>Diinput</th><th>Tanggal pengeluaran</th><th>Cabang</th><th>Pelaku</th><th>Kategori</th><th style={{ textAlign: "right" }}>Jumlah</th><th>Alasan</th><th style={{ textAlign: "center" }}>Detail</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const k = kini.get(r.expense_id);
                  const lintas = lintasBulan(r.effective_date, r.recorded_at);
                  return (
                    <tr key={r.expense_id} style={k?.voided_at ? { opacity: 0.6 } : undefined}>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{waktu(r.recorded_at)} <span style={{ fontSize: 9.5 }}>WIB</span></td>
                      <td style={{ fontSize: 11 }}>
                        {formatTanggalID(r.effective_date)} <span style={{ fontSize: 9.5, color: "var(--td)" }}>({selisihHari(r.effective_date, r.recorded_at)} hari mundur)</span>
                        {lintas && <span className="bge o" style={{ marginLeft: 5 }} title={`Diinput ${formatTanggalID(tanggalInputWIB(r.recorded_at))}, tetapi jatuh di bulan ${r.effective_date.slice(0, 7)}`}>Lintas bulan</span>}
                        {k && k.tanggal !== r.effective_date && <div style={{ fontSize: 9.5, color: "var(--td)" }}>kini {formatTanggalID(k.tanggal)} (diubah lewat koreksi)</div>}
                        {k?.voided_at && <span className="bge r" style={{ marginLeft: 5 }}>Dibatalkan</span>}
                      </td>
                      <td style={{ fontSize: 11 }}>{nama.cabang.get(r.branch_id) ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{nama.pelaku.get(r.actor_id) ?? "—"}<div style={{ fontSize: 9.5, color: "var(--td)" }}>{KONTEKS[r.context] ?? r.context}</div></td>
                      <td style={{ fontSize: 11 }}>{r.kategori}</td>
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, textDecoration: k?.voided_at ? "line-through" : undefined }}>{rp(nominal(r))}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.reason}</td>
                      <td style={{ textAlign: "center" }}><Link href={`/buku-besar/beban/${r.expense_id}`} className="btn-def" style={{ padding: "2px 8px", fontSize: 10, textDecoration: "none" }}>Detail</Link></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada pengeluaran bertanggal mundur pada periode input ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
