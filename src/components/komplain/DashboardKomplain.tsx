import Link from "next/link";
import { Donut } from "@/components/Charts";
import { WARNA_TINGKAT, tanggalPendek, tautanFilter, teksHari, teksJam, type Dashboard, type FilterKomplain } from "@/lib/komplain";
import { TabelKomplain } from "./DaftarKomplain";
import s from "./komplain.module.css";

function Kartu({ angka, label, bahaya = false, bantu }: { angka: string; label: string; bahaya?: boolean; bantu?: string }) {
  return <div className={`${s.kartu}${bahaya ? ` ${s.bahaya}` : ""}`}><div className={s.angka}>{angka}</div><div className={s.label}>{label}</div>{bantu && <div className={s.meta}>{bantu}</div>}</div>;
}

function Batang({ baris, kosong }: { baris: { nama: string; jumlah: number; terbuka?: number }[]; kosong: string }) {
  const maks = Math.max(1, ...baris.map(b => b.jumlah));
  if (baris.length === 0 || baris.every(b => b.jumlah === 0)) return <div className={s.kosong}>{kosong}</div>;
  return (
    <div>{baris.map(b => (
      <div key={b.nama} className={s.bar}>
        <span title={b.nama}>{b.nama}</span>
        <span className={s.batang} role="img" aria-label={`${b.nama}: ${b.jumlah}`}><span className={s.isi} style={{ display: "block", width: `${(b.jumlah / maks) * 100}%` }} /></span>
        <b>{b.jumlah}{b.terbuka != null ? <span className={s.meta}> ({b.terbuka} terbuka)</span> : null}</b>
      </div>
    ))}</div>
  );
}

/** Grafik batang tren (per hari bila rentang ≤ 45 hari, selain itu per minggu). Murni SVG/CSS, tanpa pustaka. */
function Tren({ d }: { d: Dashboard }) {
  const harian = d.tren_hari.length <= 45;
  const titik = harian ? d.tren_hari.map(t => ({ k: t.tanggal, n: t.jumlah })) : d.tren_minggu.map(t => ({ k: t.minggu, n: t.jumlah }));
  const maks = Math.max(1, ...titik.map(t => t.n));
  if (titik.every(t => t.n === 0)) return <div className={s.kosong}>Tidak ada komplain pada rentang ini.</div>;
  return (
    <div>
      <div className={s.meta}>{harian ? "Komplain per hari" : "Komplain per minggu (mulai Senin)"} · tertinggi {maks}</div>
      <div className={s.tren} role="img" aria-label={harian ? "Grafik komplain per hari" : "Grafik komplain per minggu"}>
        {titik.map(t => (
          <div key={t.k} className={s.trenKolom} title={`${tanggalPendek(t.k)}: ${t.n}`}>
            <div className={s.trenBatang} style={{ height: `${(t.n / maks) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className={s.trenSumbu}><span>{tanggalPendek(titik[0].k)}</span><span>{tanggalPendek(titik[titik.length - 1].k)}</span></div>
    </div>
  );
}

export function DashboardKomplain({ d, filter }: { d: Dashboard; filter: FilterKomplain }) {
  const k = d.kpi;
  const tingkat = d.per_tingkat;
  return (
    <>
      <div className={s.kpi}>
        <Kartu angka={String(k.terbuka)} label="Komplain terbuka" bantu="semua yang belum ditutup" />
        <Kartu angka={String(k.terlambat)} label={`Terlambat (> ${d.hari_telat} hari)`} bahaya={k.terlambat > 0} />
        <Kartu angka={String(k.kritis_terbuka)} label="Kritis, belum selesai" bahaya={k.kritis_terbuka > 0} />
        <Kartu angka={String(k.ditutup_bulan_ini)} label="Ditutup bulan ini" />
        <Kartu angka={teksJam(k.rata_respons_jam)} label="Rata-rata respons pertama" />
        <Kartu angka={teksHari(k.rata_selesai_hari)} label="Rata-rata waktu penyelesaian" />
        <Kartu angka={String(k.total)} label={`Komplain ${tanggalPendek(d.rentang.dari)} – ${tanggalPendek(d.rentang.sampai)}`} bantu={`${k.ditutup_rentang} sudah ditutup`} />
      </div>

      <div className={s.dua}>
        <div className="card"><div className="card-hd"><i className="ti ti-chart-bar" /> Tren komplain</div><Tren d={d} /></div>
        <div className="card"><div className="card-hd"><i className="ti ti-alert-triangle" /> Menurut tingkat</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Donut size={110} centerLabel={String(k.total)} centerSub="komplain"
              segments={tingkat.map(t => ({ value: t.jumlah, color: (WARNA_TINGKAT[t.tingkat] ?? WARNA_TINGKAT.Rendah).warna }))} />
            <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12.5 }}>
              {tingkat.map(t => <li key={t.tingkat}><span style={{ color: (WARNA_TINGKAT[t.tingkat] ?? WARNA_TINGKAT.Rendah).warna }}>●</span> {t.tingkat}: <b>{t.jumlah}</b> <span className={s.meta}>({t.terbuka} terbuka)</span></li>)}
            </ul>
          </div>
        </div>
      </div>

      <div className={s.dua}>
        <div className="card"><div className="card-hd"><i className="ti ti-building-store" /> Per cabang</div>
          <Batang baris={d.per_cabang.map(c => ({ nama: c.cabang ?? "—", jumlah: c.jumlah, terbuka: c.terbuka }))} kosong="Belum ada komplain." /></div>
        <div className="card"><div className="card-hd"><i className="ti ti-category" /> Per kategori</div>
          <Batang baris={d.per_kategori.map(c => ({ nama: c.kategori ?? "—", jumlah: c.jumlah, terbuka: c.terbuka }))} kosong="Belum ada komplain." /></div>
        <div className="card"><div className="card-hd"><i className="ti ti-route" /> Per status</div>
          <Batang baris={d.per_status.map(c => ({ nama: c.status, jumlah: c.jumlah }))} kosong="Belum ada komplain." /></div>
        <div className="card"><div className="card-hd"><i className="ti ti-device-mobile" /> Per asal komplain</div>
          <Batang baris={d.per_kanal.map(c => ({ nama: c.kanal, jumlah: c.jumlah }))} kosong="Belum ada komplain." /></div>
      </div>

      <div className={s.dua}>
        <div className="card"><div className="card-hd"><i className="ti ti-repeat" /> Pelanggan yang berulang kali komplain</div>
          {d.pelanggan_berulang.length === 0 ? <div className={s.kosong}>Belum ada pelanggan dengan 2 komplain atau lebih pada rentang ini.</div> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{d.pelanggan_berulang.map((p, i) => (
              <li key={`${p.pelanggan_id ?? p.nama}-${i}`}>{p.nama ?? "Tanpa nama"}{p.telepon ? ` · ${p.telepon}` : ""} — <b>{p.jumlah}×</b> <span className={s.meta}>terakhir {tanggalPendek(p.terakhir)}</span></li>))}</ul>)}
        </div>
        <div className="card"><div className="card-hd"><i className="ti ti-user-exclamation" /> Karyawan yang paling sering disebut</div>
          {d.karyawan_disebut.length === 0 ? <div className={s.kosong}>Belum ada komplain yang menyebut karyawan pada rentang ini.</div> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{d.karyawan_disebut.map(p => (
              <li key={p.karyawan_id}>{p.nama ?? "—"} — <b>{p.jumlah}×</b> <span className={s.meta}>terakhir {tanggalPendek(p.terakhir)}</span></li>))}</ul>)}
          <div className={s.meta} style={{ marginTop: 6 }}>Disebutnya karyawan belum berarti bersalah; periksa tiap komplain sebelum menyimpulkan.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><i className="ti ti-hourglass" /> Komplain terbuka, tertua dulu <span className={s.meta}>(maks. 50; tidak dibatasi rentang tanggal)</span></div>
        <TabelKomplain baris={d.umur_terbuka} kosong="Tidak ada komplain yang masih terbuka. 🎉" />
        <div className={s.aksi}><Link className="btn-def" style={{ textDecoration: "none" }} prefetch={false} href={tautanFilter("/crm/komplain", filter, { status: "terbuka", urut: "umur", hal: 1, dari: "", sampai: "" })}>Lihat semua yang terbuka →</Link></div>
      </div>
    </>
  );
}
