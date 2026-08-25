import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { tarikRiwayat } from "@/lib/laporan-transaksi-server";
import { profilPelanggan, pelangganBaru, baruVsLama } from "@/lib/retensi";
import { pertumbuhanBulanan, labelBulan } from "@/lib/pertumbuhan";

// Akuisisi Pelanggan — permintaan Kamo Group 24 Agu 2026:
// "pelanggan baru per cabang per periode" dan "rasio pelanggan baru vs lama per transaksi".
//
// "Baru" diukur dari transaksi PERTAMA, bukan tanggal daftar di kartu pelanggan:
// orang yang didaftarkan admin tahun lalu tapi baru belanja bulan ini adalah
// pelanggan baru menurut ukuran yang berguna buat marketing.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const persen = (x: number) => `${Math.round(x * 100)}%`;

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function AkuisisiPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();

  const { trx, terpotong } = await tarikRiwayat(sampai);
  const profil = profilPelanggan(
    trx.filter((t) => t.customerId)
      .map((t) => ({ customerId: t.customerId as string, tanggal: t.tanggal, cabang: t.cabang })),
  );

  const diRentang = trx.filter((t) => t.tanggal >= dari && t.tanggal <= sampai);
  const perCabangBaru = pelangganBaru(profil, dari, sampai);
  const perCabangRasio = baruVsLama(diRentang, profil, dari);

  const totalBaru = perCabangBaru.reduce((a, r) => a + r.baru, 0);
  const t = perCabangRasio.reduce(
    (a, r) => ({
      baru: a.baru + r.baru, omzetBaru: a.omzetBaru + r.omzetBaru,
      lama: a.lama + r.lama, omzetLama: a.omzetLama + r.omzetLama,
      takDikenal: a.takDikenal + r.takDikenal, omzetTakDikenal: a.omzetTakDikenal + r.omzetTakDikenal,
    }),
    { baru: 0, omzetBaru: 0, lama: 0, omzetLama: 0, takDikenal: 0, omzetTakDikenal: 0 },
  );
  const dikenal = t.baru + t.lama;
  const rasioTotal = dikenal ? t.baru / dikenal : 0;

  // Tren bulanan pelanggan baru — pakai tanggal transaksi pertamanya.
  const titik = pertumbuhanBulanan(profil.map((p) => p.pertama), dari, sampai);
  const puncak = Math.max(1, ...titik.map((x) => x.baru));

  return (
    <LaporanPage
      icon="ti-user-plus" title="AKUISISI PELANGGAN"
      desc="Berapa pelanggan baru tiap cabang, dan berapa banyak transaksi yang datang dari orang baru."
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
          { label: "Pelanggan baru", nilai: `${totalBaru} orang`, warna: "#15803d" },
          { label: "Transaksi dari pelanggan baru", nilai: `${t.baru}x` },
          { label: "Transaksi dari pelanggan lama", nilai: `${t.lama}x` },
          { label: "Porsi transaksi pelanggan baru", nilai: persen(rasioTotal) },
          { label: "Omzet pelanggan baru", nilai: rp(t.omzetBaru), warna: "#15803d" },
          { label: "Omzet pelanggan lama", nilai: rp(t.omzetLama) },
        ]} />
      }
    >
      {terpotong && (
        <div className="crm-sec" style={{ marginBottom: 12, fontSize: 11, color: "#b45309" }}>
          <i className="ti ti-alert-triangle" /> Riwayat transaksinya sudah sangat panjang dan
          sebagian belum ikut terhitung. Angka &quot;pelanggan baru&quot; bisa terlalu besar.
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · PELANGGAN BARU PER CABANG</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 460 }}>
            <thead>
              <tr>
                <th>Cabang</th>
                <th style={{ width: 130, textAlign: "center" }}>Pelanggan baru</th>
                <th style={{ width: 120, textAlign: "right" }}>Porsi</th>
              </tr>
            </thead>
            <tbody>
              {perCabangBaru.map((r) => (
                <tr key={r.cabang}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.cabang}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{r.baru}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                    {totalBaru ? persen(r.baru / totalBaru) : "—"}
                  </td>
                </tr>
              ))}
              {perCabangBaru.length === 0 && <TabelKosong kolom={3} pesan="Tidak ada pelanggan baru di rentang ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Cabangnya adalah tempat orang itu PERTAMA KALI bertransaksi, jadi tiap pelanggan baru
          hanya dihitung di satu cabang — tidak ada yang terhitung dua kali.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · PELANGGAN BARU PER BULAN</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Bulan</th>
                <th style={{ width: 110, textAlign: "center" }}>Pelanggan baru</th>
                <th>Grafik</th>
                <th style={{ width: 130, textAlign: "right" }}>Total pelanggan</th>
              </tr>
            </thead>
            <tbody>
              {titik.map((x) => (
                <tr key={x.bulan} style={x.baru ? undefined : { opacity: .5 }}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{labelBulan(x.bulan)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{x.baru}</td>
                  <td>
                    <div style={{
                      height: 10, borderRadius: 5, background: "#15803d",
                      width: `${Math.max(x.baru ? 3 : 0, (x.baru / puncak) * 100)}%`,
                    }} />
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{x.kumulatif}</td>
                </tr>
              ))}
              {titik.length === 0 && <TabelKosong kolom={4} pesan="Rentang tanggalnya terbalik." />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · TRANSAKSI: PELANGGAN BARU vs LAMA</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Cabang</th>
                <th style={{ width: 80, textAlign: "center" }}>Baru</th>
                <th style={{ width: 130, textAlign: "right" }}>Omzet baru</th>
                <th style={{ width: 80, textAlign: "center" }}>Lama</th>
                <th style={{ width: 130, textAlign: "right" }}>Omzet lama</th>
                <th style={{ width: 110, textAlign: "center" }}>Tanpa identitas</th>
                <th style={{ width: 140 }}>Porsi pelanggan baru</th>
              </tr>
            </thead>
            <tbody>
              {perCabangRasio.map((r) => (
                <tr key={r.cabang}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.cabang}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "#15803d" }}>{r.baru}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{r.omzetBaru ? rp(r.omzetBaru) : "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{r.lama}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{r.omzetLama ? rp(r.omzetLama) : "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11, color: r.takDikenal ? "#b45309" : "var(--td)" }}>
                    {r.takDikenal || "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--sf1)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${r.rasioBaru * 100}%`, background: "#15803d" }} />
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, width: 34, textAlign: "right" }}>
                        {r.baru + r.lama ? persen(r.rasioBaru) : "—"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {perCabangRasio.length === 0 && <TabelKosong kolom={7} pesan="Belum ada transaksi di rentang ini." />}
            </tbody>
            {perCabangRasio.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ fontSize: 11.5 }}>TOTAL</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{t.baru}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(t.omzetBaru)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{t.lama}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(t.omzetLama)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{t.takDikenal || "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{persen(rasioTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Struk yang identitas pembelinya tidak dicatat dilaporkan terpisah dan TIDAK ikut membagi
          porsi — kalau ikut, pelanggan lama terlihat menyusut padahal cuma tidak dicatat namanya.
          Di cabang yang angka &quot;tanpa identitas&quot;-nya besar, porsi di sebelah kanan belum bisa
          dipercaya penuh; itu tanda kasirnya perlu dibiasakan menanyakan nama pelanggan.
        </div>
      </div>
    </LaporanPage>
  );
}
