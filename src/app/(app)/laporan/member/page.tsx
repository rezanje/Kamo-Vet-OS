import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { pertumbuhanBulanan, labelBulan, rekapPoin } from "@/lib/pertumbuhan";
import { hariIniWIB, tanggalWIB } from "@/lib/tanggal";

// Member & Poin — menjawab dua baris permintaan Kamo Group (24 Agu 2026):
// "pertumbuhan anggota member" dan "cashback/poin: terkumpul, ditukar, saldo".
// Digabung dalam satu layar karena dibaca orang yang sama: tim marketing.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const num = (n: number) => Math.round(n).toLocaleString("id-ID");
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Default setahun ke belakang — pertumbuhan baru kelihatan kalau rentangnya panjang.
function setahunLalu(): string {
  const t = hariIniWIB();
  return `${Number(t.slice(0, 4)) - 1}${t.slice(4, 8)}01`;
}

export default async function MemberPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || setahunLalu();
  const sampai = sp.sampai || hariIniWIB();

  const supabase = await createClient();
  const [{ data: custs }, { data: ledger }, { data: semuaMutasi }] = await Promise.all([
    supabase.from("customers")
      .select("id, name, tier, points, created_at, customer_categories(nama)")
      .order("created_at"),
    supabase.from("point_ledger")
      .select("customer_id, delta, created_at, description")
      .gte("created_at", `${dari}T00:00:00+07:00`).lte("created_at", `${sampai}T23:59:59+07:00`)
      .order("created_at", { ascending: false }),
    // Tanpa batas tanggal — dipakai memeriksa apakah saldo poin di kartu pelanggan
    // benar-benar terjelaskan oleh riwayat transaksinya.
    supabase.from("point_ledger").select("delta"),
  ]);

  type Cust = {
    id: string; name: string; tier: string | null; points: number | null;
    created_at: string; customer_categories: Rel<{ nama: string }>;
  };
  const pelanggan = ((custs ?? []) as unknown as Cust[]).map((c) => ({
    id: c.id, nama: c.name, tier: c.tier || "New",
    golongan: one(c.customer_categories)?.nama ?? "(belum digolongkan)",
    poin: Number(c.points) || 0,
    gabung: tanggalWIB(c.created_at),
  }));

  const titik = pertumbuhanBulanan(pelanggan.map((c) => c.gabung), dari, sampai);
  const puncak = Math.max(1, ...titik.map((t) => t.baru));
  const baruDiRentang = titik.reduce((a, t) => a + t.baru, 0);

  const hitung = (kunci: "golongan" | "tier") => {
    const m = new Map<string, number>();
    for (const c of pelanggan) m.set(c[kunci], (m.get(c[kunci]) ?? 0) + 1);
    return [...m].map(([nama, n]) => ({ nama, n })).sort((a, b) => b.n - a.n);
  };
  const perGolongan = hitung("golongan");
  const perTier = hitung("tier");

  type Led = { customer_id: string | null; delta: number; created_at: string; description: string | null };
  const mutasi = (ledger ?? []) as Led[];
  const poin = rekapPoin(mutasi.map((m) => m.delta));
  const saldoSekarang = pelanggan.reduce((a, c) => a + c.poin, 0);
  const netSeluruhRiwayat = ((semuaMutasi ?? []) as { delta: number }[])
    .reduce((a, m) => a + (Number(m.delta) || 0), 0);
  const poinTakTerjelaskan = Math.round(saldoSekarang) - Math.round(netSeluruhRiwayat);

  const namaPelanggan = new Map(pelanggan.map((c) => [c.id, c.nama]));
  const perPelanggan = new Map<string, { terkumpul: number; ditukar: number }>();
  for (const m of mutasi) {
    const k = m.customer_id ?? "—";
    const cur = perPelanggan.get(k) ?? { terkumpul: 0, ditukar: 0 };
    const d = Number(m.delta) || 0;
    if (d > 0) cur.terkumpul += d; else cur.ditukar += -d;
    perPelanggan.set(k, cur);
  }
  const poinRows = [...perPelanggan].map(([id, v]) => ({
    id,
    nama: namaPelanggan.get(id) ?? "(pelanggan terhapus)",
    ...v,
    saldo: pelanggan.find((c) => c.id === id)?.poin ?? 0,
  })).sort((a, b) => (b.terkumpul + b.ditukar) - (a.terkumpul + a.ditukar));

  return (
    <LaporanPage
      icon="ti-users" title="MEMBER & POIN"
      desc="Pertumbuhan anggota member per bulan, komposisinya, dan pergerakan poin loyalty."
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
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Total member", nilai: `${pelanggan.length} orang` },
          { label: "Member baru di rentang ini", nilai: `${baruDiRentang} orang`, warna: "#15803d" },
          { label: "Poin terkumpul", nilai: num(poin.terkumpul), warna: "#15803d" },
          { label: "Poin ditukar", nilai: `− ${num(poin.ditukar)}`, warna: "#b45309" },
          { label: "Saldo poin sekarang", nilai: num(saldoSekarang) },
          { label: "Nilai kewajiban poin", nilai: rp(saldoSekarang) },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          fontSize: 11, color: poinTakTerjelaskan === 0 ? "#15803d" : "#b45309",
        }}>
          <i className={`ti ${poinTakTerjelaskan === 0 ? "ti-circle-check" : "ti-alert-triangle"}`} style={{ fontSize: 16 }} />
          <div>
            <b>Saldo poin cocok dengan riwayatnya?</b>{" "}
            Saldo di kartu pelanggan {num(saldoSekarang)} · dijelaskan riwayat transaksi {num(netSeluruhRiwayat)}
            {poinTakTerjelaskan === 0
              ? " — cocok."
              : ` — ada ${num(Math.abs(poinTakTerjelaskan))} poin yang tidak berasal dari transaksi mana pun (biasanya saldo awal saat data dipindahkan, atau poin yang diberikan manual).`}
          </div>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 10 }}>01 · PERTUMBUHAN MEMBER PER BULAN</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Bulan</th>
                <th style={{ width: 100, textAlign: "center" }}>Member baru</th>
                <th>Grafik</th>
                <th style={{ width: 120, textAlign: "right" }}>Total member</th>
              </tr>
            </thead>
            <tbody>
              {titik.map((t) => (
                <tr key={t.bulan} style={t.baru ? undefined : { opacity: .5 }}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelBulan(t.bulan)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{t.baru}</td>
                  <td>
                    <div style={{
                      height: 10, borderRadius: 5, background: "var(--posb)",
                      width: `${Math.max(t.baru ? 3 : 0, (t.baru / puncak) * 100)}%`,
                    }} />
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{t.kumulatif}</td>
                </tr>
              ))}
              {titik.length === 0 && <TabelKosong kolom={4} pesan="Rentang tanggalnya terbalik — tanggal awal lebih besar dari tanggal akhir." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          &quot;Total member&quot; adalah jumlah kumulatif sampai bulan itu, sudah termasuk member yang
          mendaftar sebelum rentang tanggal dipilih. Panjang batang dibandingkan terhadap bulan terbaik
          di rentang ini, bukan terhadap target.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12, display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · KOMPOSISI PER GOLONGAN</div>
          <table className="tbl">
            <thead><tr><th>Golongan</th><th style={{ width: 90, textAlign: "right" }}>Member</th></tr></thead>
            <tbody>
              {perGolongan.map((g) => (
                <tr key={g.nama}>
                  <td style={{ fontSize: 11 }}>{g.nama}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{g.n}</td>
                </tr>
              ))}
              {perGolongan.length === 0 && <TabelKosong kolom={2} pesan="Belum ada member." />}
            </tbody>
          </table>
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · KOMPOSISI PER STRATA</div>
          <table className="tbl">
            <thead><tr><th>Strata</th><th style={{ width: 90, textAlign: "right" }}>Member</th></tr></thead>
            <tbody>
              {perTier.map((g) => (
                <tr key={g.nama}>
                  <td style={{ fontSize: 11 }}>{g.nama}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{g.n}</td>
                </tr>
              ))}
              {perTier.length === 0 && <TabelKosong kolom={2} pesan="Belum ada member." />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>04 · POIN LOYALTY PER PELANGGAN</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>Pelanggan</th>
                <th style={{ width: 130, textAlign: "right" }}>Terkumpul</th>
                <th style={{ width: 130, textAlign: "right" }}>Ditukar</th>
                <th style={{ width: 130, textAlign: "right" }}>Saldo sekarang</th>
              </tr>
            </thead>
            <tbody>
              {poinRows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.terkumpul ? "#15803d" : "var(--td)" }}>
                    {r.terkumpul ? num(r.terkumpul) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.ditukar ? "#b45309" : "var(--td)" }}>
                    {r.ditukar ? `− ${num(r.ditukar)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{num(r.saldo)}</td>
                </tr>
              ))}
              {poinRows.length === 0 && <TabelKosong kolom={4} pesan="Belum ada pergerakan poin di rentang ini." />}
            </tbody>
            {poinRows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ fontSize: 11.5 }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{num(poin.terkumpul)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>− {num(poin.ditukar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{num(saldoSekarang)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Kolom &quot;terkumpul&quot; dan &quot;ditukar&quot; dihitung dari rentang tanggal yang dipilih;
          kolom &quot;saldo sekarang&quot; adalah posisi hari ini, jadi keduanya tidak harus selisih persis.
          1 poin bernilai Rp 1 saat ditukar — angka &quot;nilai kewajiban poin&quot; di atas adalah potensi
          potongan harga yang masih menempel di pelanggan dan belum ditukar.
        </div>
      </div>
    </LaporanPage>
  );
}
