import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { TINDAKAN_KATEGORI } from "@/lib/tindakan";
import { FOLLOWUP_JENIS } from "@/lib/followup";
import { hariRawatInap } from "@/lib/inpatient";
import { hariIniWIB } from "@/lib/tanggal";

// Rekap Klinik — menjawab tiga baris di daftar permintaan Kamo Group (24 Agu 2026):
// daftar kategori layanan (rawat inap, grooming, dll), rekap kondisi pasien
// (sembuh / kontrol / RIP), dan follow up dipecah per jenis.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmt = (s: string) =>
  s ? new Date(s).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "2-digit" }) : "—";

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

const KONDISI = ["stabil", "kritis", "sembuh", "rip"] as const;
const KONDISI_LABEL: Record<string, string> = {
  stabil: "Stabil", kritis: "Kritis", sembuh: "Sembuh / boleh pulang", rip: "RIP (meninggal)",
};
const KONDISI_WARNA: Record<string, string> = {
  stabil: "#15803d", kritis: "#b91c1c", sembuh: "#2563eb", rip: "#7f1d1d",
};

const FU_STATUS = ["Menunggu", "Terkirim", "Selesai", "Batal"] as const;

export default async function RekapKlinikPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";

  const mulai = `${dari}T00:00:00+07:00`;
  const akhir = `${sampai}T23:59:59+07:00`;

  const supabase = await createClient();
  const [{ data: itemRows }, { data: inapRows }, { data: fuRows }, { data: branches }] = await Promise.all([
    supabase.from("invoice_items")
      .select("qty, harga, jenis, items(tindakan_kategori, item_type), invoices!inner(created_at, voided_at, visits!inner(branch_id))")
      .gte("invoices.created_at", mulai).lte("invoices.created_at", akhir)
      .is("invoices.voided_at", null),
    supabase.from("inpatient_records")
      .select("id, condition_status, admitted_at, discharged_at, doctor_name, branch_id, visits(pets(name), customers(name))")
      .gte("admitted_at", mulai).lte("admitted_at", akhir)
      .order("admitted_at", { ascending: false }),
    supabase.from("follow_ups")
      .select("jenis, status, tanggal, branch_id")
      .gte("tanggal", dari).lte("tanggal", sampai),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  // ── 1. Layanan per kategori ────────────────────────────────────────────────
  type ItemRow = {
    qty: number; harga: number; jenis: string | null;
    items: Rel<{ tindakan_kategori: string | null; item_type: string | null }>;
    invoices: Rel<{ visits: Rel<{ branch_id: string | null }> }>;
  };
  const kategoriAgg = new Map<string, { jumlah: number; qty: number; nilai: number }>();
  for (const r of (itemRows ?? []) as unknown as ItemRow[]) {
    const inv = one(r.invoices);
    const branchId = one(inv?.visits ?? null)?.branch_id ?? null;
    if (cabang && branchId !== cabang) continue;
    const it = one(r.items);
    const kunci = r.jenis === "jasa"
      ? (it?.tindakan_kategori || "Jasa tanpa kategori")
      : r.jenis === "obat" ? "Obat & resep" : "Barang lain";
    const cur = kategoriAgg.get(kunci) ?? { jumlah: 0, qty: 0, nilai: 0 };
    cur.jumlah++;
    cur.qty += Number(r.qty) || 0;
    cur.nilai += (Number(r.qty) || 0) * (Number(r.harga) || 0);
    kategoriAgg.set(kunci, cur);
  }

  // ── 2. Rawat inap ──────────────────────────────────────────────────────────
  type InapRow = {
    id: string; condition_status: string | null; admitted_at: string; discharged_at: string | null;
    doctor_name: string | null; branch_id: string | null;
    visits: Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string }> }>;
  };
  const inap = ((inapRows ?? []) as unknown as InapRow[])
    .filter((r) => !cabang || r.branch_id === cabang)
    .map((r) => {
      const v = one(r.visits);
      return {
        id: r.id,
        kondisi: r.condition_status ?? "stabil",
        pasien: one(v?.pets ?? null)?.name ?? "—",
        pemilik: one(v?.customers ?? null)?.name ?? "—",
        dokter: r.doctor_name ?? "—",
        masuk: r.admitted_at,
        keluar: r.discharged_at,
        // Pasien yang masih dirawat dihitung sampai sekarang — sama seperti layar rawat inap.
        hari: hariRawatInap(r.admitted_at, r.discharged_at ?? new Date().toISOString()),
      };
    });
  const perKondisi = KONDISI.map((k) => ({ k, n: inap.filter((r) => r.kondisi === k).length }));
  const totalHariInap = inap.reduce((a, r) => a + r.hari, 0);

  // Rawat inap ditagih dari catatan menginapnya, bukan dari baris jasa —
  // jadi kategorinya ditambahkan sendiri supaya tidak hilang dari daftar layanan.
  if (inap.length > 0) {
    kategoriAgg.set("Rawat Inap", {
      jumlah: inap.length, qty: totalHariInap,
      nilai: kategoriAgg.get("Rawat Inap")?.nilai ?? 0,
    });
  }

  const kategoriRows = [...kategoriAgg].map(([nama, v]) => ({ nama, ...v }))
    .sort((a, b) => b.nilai - a.nilai || b.jumlah - a.jumlah);

  // Kategori tindakan yang terdaftar tapi tidak dipakai sama sekali — tetap ditampilkan
  // sebagai baris nol supaya "tidak ada grooming bulan ini" terbaca, bukan menghilang.
  const terpakai = new Set(kategoriRows.map((r) => r.nama));
  const kategoriKosong = TINDAKAN_KATEGORI.filter((k) => !terpakai.has(k));

  // ── 3. Follow up ───────────────────────────────────────────────────────────
  type FuRow = { jenis: string; status: string; tanggal: string; branch_id: string | null };
  const fu = ((fuRows ?? []) as FuRow[]).filter((r) => !cabang || r.branch_id === cabang);
  const fuJenis = [...FOLLOWUP_JENIS];
  const fuAgg = fuJenis.map((j) => {
    const isi = fu.filter((r) => r.jenis === j);
    return {
      jenis: j,
      total: isi.length,
      per: Object.fromEntries(FU_STATUS.map((s) => [s, isi.filter((r) => r.status === s).length])) as Record<string, number>,
    };
  });
  const fuLain = fu.filter((r) => !fuJenis.includes(r.jenis as (typeof FOLLOWUP_JENIS)[number]));

  const totalNilai = kategoriRows.reduce((a, r) => a + r.nilai, 0);

  return (
    <LaporanPage
      icon="ti-stethoscope" title="REKAP KLINIK"
      desc="Layanan per kategori, kondisi pasien rawat inap, dan follow up dipecah per jenis."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Nilai layanan klinik", nilai: rp(totalNilai), warna: "#15803d" },
          { label: "Pasien rawat inap", nilai: `${inap.length} pasien` },
          { label: "Total hari inap", nilai: `${totalHariInap} hari` },
          { label: "RIP", nilai: `${perKondisi.find((x) => x.k === "rip")?.n ?? 0} pasien`, warna: "#7f1d1d" },
          { label: "Follow up dijadwalkan", nilai: `${fu.length} agenda` },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · LAYANAN PER KATEGORI</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Kategori</th>
                <th style={{ width: 110, textAlign: "center" }}>Jumlah baris</th>
                <th style={{ width: 110, textAlign: "center" }}>Kuantitas</th>
                <th style={{ width: 160, textAlign: "right" }}>Nilai</th>
              </tr>
            </thead>
            <tbody>
              {kategoriRows.map((r) => (
                <tr key={r.nama}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.jumlah}</td>
                  <td style={{ textAlign: "center", fontSize: 11, color: "var(--tm)" }}>{r.qty}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{r.nilai ? rp(r.nilai) : "—"}</td>
                </tr>
              ))}
              {kategoriKosong.map((k) => (
                <tr key={k} style={{ opacity: .5 }}>
                  <td style={{ fontSize: 11.5 }}>{k}</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>0</td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>0</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>—</td>
                </tr>
              ))}
              {kategoriRows.length === 0 && kategoriKosong.length === 0 && (
                <TabelKosong kolom={4} pesan="Belum ada tagihan klinik di rentang ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Kategori diambil dari kategori tindakan pada masing-masing jasa. Rawat inap ditagih dari
          catatan menginapnya (kuantitas = jumlah hari), bukan dari baris jasa, jadi nilainya baru
          muncul setelah tarif rawat inap dipasang sebagai barang jasa.
          Baris pucat berarti kategori itu tidak terpakai sama sekali di rentang ini.
          Pet Hotel belum ada sebagai kategori tindakan — perlu ditambahkan kalau layanannya dijual terpisah.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · KONDISI PASIEN RAWAT INAP</div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 10 }}>
          {perKondisi.map(({ k, n }) => (
            <div key={k}>
              <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: .3 }}>
                {KONDISI_LABEL[k]}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: n ? KONDISI_WARNA[k] : "var(--td)" }}>{n} pasien</div>
            </div>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Pasien</th>
                <th style={{ width: 170 }}>Pemilik</th>
                <th style={{ width: 150 }}>Dokter</th>
                <th style={{ width: 90 }}>Masuk</th>
                <th style={{ width: 90 }}>Keluar</th>
                <th style={{ width: 70, textAlign: "center" }}>Hari</th>
                <th style={{ width: 150 }}>Kondisi</th>
              </tr>
            </thead>
            <tbody>
              {inap.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.pasien}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.pemilik}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.dokter}</td>
                  <td style={{ fontSize: 10.5 }}>{fmt(r.masuk)}</td>
                  <td style={{ fontSize: 10.5, color: r.keluar ? "var(--td)" : "#b45309" }}>
                    {r.keluar ? fmt(r.keluar) : "masih dirawat"}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700 }}>{r.hari}</td>
                  <td style={{ fontSize: 11, fontWeight: 700, color: KONDISI_WARNA[r.kondisi] ?? "var(--tm)" }}>
                    {KONDISI_LABEL[r.kondisi] ?? r.kondisi}
                  </td>
                </tr>
              ))}
              {inap.length === 0 && <TabelKosong kolom={7} pesan="Tidak ada pasien rawat inap di rentang ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Yang dihitung adalah pasien yang MASUK di rentang tanggal ini. Pasien yang masih dirawat
          jumlah harinya dihitung sampai hari ini dan masih bisa bertambah.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · FOLLOW UP PER JENIS</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Jenis</th>
                <th style={{ width: 90, textAlign: "center" }}>Total</th>
                {FU_STATUS.map((s) => <th key={s} style={{ width: 90, textAlign: "center" }}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {fuAgg.map((r) => (
                <tr key={r.jenis} style={r.total ? undefined : { opacity: .5 }}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.jenis}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{r.total}</td>
                  {FU_STATUS.map((s) => (
                    <td key={s} style={{ textAlign: "center", fontSize: 11, color: r.per[s] ? "var(--sb)" : "var(--td)" }}>
                      {r.per[s]}
                    </td>
                  ))}
                </tr>
              ))}
              {fuLain.length > 0 && (
                <tr>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>Jenis lain (data lama)</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{fuLain.length}</td>
                  {FU_STATUS.map((s) => (
                    <td key={s} style={{ textAlign: "center", fontSize: 11 }}>
                      {fuLain.filter((r) => r.status === s).length}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Dihitung dari tanggal jadwal follow up-nya, bukan tanggal dokter membuatnya.
          &quot;Menunggu&quot; berarti belum dihubungi — itu daftar kerja harian tim, ada di layar Follow Up klinik.
        </div>
      </div>
    </LaporanPage>
  );
}
