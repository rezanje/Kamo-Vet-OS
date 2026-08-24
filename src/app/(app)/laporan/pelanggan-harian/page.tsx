import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB, rentangTanggal } from "@/lib/tanggal";
import { tanggalIndo } from "@/lib/followup";
import { tarikTransaksi } from "@/lib/laporan-transaksi-server";
import { perHari, rekap, type Kanal, type Trx } from "@/lib/laporan-transaksi";

// "Jumlah pelanggan per hari" — laporan dasar yang diminta Kamo Group (24 Agu 2026).
// Hari tanpa transaksi sengaja tetap ditampilkan sebagai baris nol: hari sepi adalah
// informasi, bukan baris yang boleh hilang dari laporan.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const angka = (n: number) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const namaHari = (t: string) => HARI[new Date(`${t}T00:00:00`).getDay()];

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

const KANAL: Kanal[] = ["POS", "Online", "Klinik"];

export default async function PelangganHarianPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string; kanal?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";
  const kanal = (sp.kanal || "") as Kanal | "";

  const { trx: semua, cabangList, terpotong } = await tarikTransaksi(dari, sampai);
  const trx: Trx[] = semua.filter(
    (t) => (!cabang || t.cabang === cabang) && (!kanal || t.kanal === kanal),
  );

  const isiPerHari = new Map(perHari(trx).map((h) => [h.tanggal, h]));
  const kanalPerHari = new Map<string, Record<Kanal, number>>();
  for (const t of trx) {
    const k = kanalPerHari.get(t.tanggal) ?? { POS: 0, Online: 0, Klinik: 0 };
    k[t.kanal]++;
    kanalPerHari.set(t.tanggal, k);
  }

  // rentangTanggal berhenti di 366 hari; laporan setahun penuh masih utuh.
  const hari = rentangTanggal(dari, sampai).reverse();
  const total = rekap(trx);
  const hariRamai = [...isiPerHari.values()].sort((a, b) => b.pelangganDilayani - a.pelangganDilayani)[0];
  const hariBertransaksi = isiPerHari.size;
  // Rata-rata harian dijumlahkan dari baris HARIAN, bukan dari total rentang: orang
  // yang datang di tiga hari berbeda dihitung sekali di total rentang, tapi tiga kali
  // di baris hariannya — memakai total rentang bikin rata-ratanya jatuh terlalu rendah.
  const orangPerHari = [...isiPerHari.values()].reduce((a, h) => a + h.pelangganDilayani, 0);

  return (
    <LaporanPage
      icon="ti-users-group" title="PELANGGAN PER HARI"
      desc="Berapa orang yang dilayani tiap hari, dari kasir petshop, pesanan online, dan klinik."
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
              {cabangList.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label className="flab">Pintu transaksi</label>
            <select className="fi" name="kanal" defaultValue={kanal}>
              <option value="">Semua</option>
              {KANAL.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Hari ada transaksi", nilai: `${hariBertransaksi} dari ${hari.length} hari` },
          { label: "Rata-rata per hari ada transaksi", nilai: `${angka(hariBertransaksi ? orangPerHari / hariBertransaksi : 0)} orang` },
          { label: "Pelanggan berbeda di rentang ini", nilai: `${total.pelangganDilayani} orang` },
          { label: "Hari teramai", nilai: hariRamai ? `${tanggalIndo(hariRamai.tanggal)} · ${hariRamai.pelangganDilayani} orang` : "—" },
          { label: "Total transaksi", nilai: `${total.trx}x` },
          { label: "Omzet", nilai: rp(total.omzet), warna: "#15803d" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        {terpotong && (
          <div style={{ fontSize: 11, color: "#b45309", marginBottom: 8 }}>
            <i className="ti ti-alert-triangle" /> Rentang tanggalnya terlalu lebar — sebagian
            transaksi belum ikut terhitung. Persempit tanggalnya supaya angkanya utuh.
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Tanggal</th>
                <th style={{ width: 80 }}>Hari</th>
                <th style={{ width: 110, textAlign: "center" }}>Pelanggan dilayani</th>
                <th style={{ width: 100, textAlign: "center" }}>Berkartu</th>
                <th style={{ width: 100, textAlign: "center" }}>Pembeli umum</th>
                <th style={{ width: 90, textAlign: "center" }}>Transaksi</th>
                <th style={{ width: 150, textAlign: "center" }}>POS / Online / Klinik</th>
                <th style={{ width: 90, textAlign: "center" }}>Rata-rata item</th>
                <th style={{ width: 140, textAlign: "right" }}>Omzet</th>
              </tr>
            </thead>
            <tbody>
              {hari.map((t) => {
                const h = isiPerHari.get(t);
                const k = kanalPerHari.get(t) ?? { POS: 0, Online: 0, Klinik: 0 };
                const sepi = !h;
                return (
                  <tr key={t} style={sepi ? { opacity: .5 } : undefined}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{tanggalIndo(t)}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{namaHari(t)}</td>
                    <td style={{ textAlign: "center", fontSize: 12, fontWeight: 700 }}>{h?.pelangganDilayani ?? 0}</td>
                    <td style={{ textAlign: "center", fontSize: 11, color: "var(--tm)" }}>{h?.pelangganTerdaftar ?? 0}</td>
                    <td style={{ textAlign: "center", fontSize: 11, color: "var(--tm)" }}>{h?.trxTanpaAkun ?? 0}</td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>{h?.trx ?? 0}x</td>
                    <td style={{ textAlign: "center", fontSize: 10.5, color: "var(--tm)" }}>
                      {k.POS} / {k.Online} / {k.Klinik}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>{h ? angka(h.rataItemPerTrx) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: h ? 700 : 400 }}>
                      {h ? rp(h.omzet) : "—"}
                    </td>
                  </tr>
                );
              })}
              {hari.length === 0 && <TabelKosong kolom={9} pesan="Rentang tanggalnya belum diisi." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Satu orang yang datang dua kali di hari yang sama dihitung satu orang, tapi dua transaksi.
          Pembeli umum adalah struk yang identitasnya tidak dicatat — tiap struk dianggap satu orang,
          jadi angka pelanggan bisa sedikit lebih tinggi dari kenyataan kalau orang yang sama belanja
          dua kali tanpa menyebut nama. Baris pucat berarti hari itu tidak ada transaksi sama sekali.<br />
          &quot;Pelanggan berbeda di rentang ini&quot; menghitung tiap orang sekali saja untuk seluruh
          rentang, jadi angkanya lebih kecil dari penjumlahan kolom harian — dan memang bukan
          penjumlahannya.
        </div>
      </div>
    </LaporanPage>
  );
}
