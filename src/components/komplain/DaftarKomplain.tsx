import Link from "next/link";
import {
  KANAL, STATUS, TINGKAT, UKURAN_HALAMAN, tanggalPendek, tautanFilter, teksUmur,
  type BarisKomplain, type FilterKomplain, type HasilDaftar, type Pilihan,
} from "@/lib/komplain";
import { LencanaStatus, LencanaTingkat } from "./KomplainUi";
import s from "./komplain.module.css";

/** Kotak saringan (formulir GET biasa: URL bisa dibagikan, tanpa JavaScript). `urut`: tampilkan kotak cari dan pilihan urutan (daftar). */
export function SaringanKomplain({ filter, pilihan, aksi, urut = false }: { filter: FilterKomplain; pilihan: Pilihan; aksi: string; urut?: boolean }) {
  return (
    <form method="get" action={aksi} className={`card ${s.filter}`} role="search">
      <div><label htmlFor="f-dari">Dari tanggal</label><input id="f-dari" className="fi" type="date" name="dari" defaultValue={filter.dari} /></div>
      <div><label htmlFor="f-sampai">Sampai tanggal</label><input id="f-sampai" className="fi" type="date" name="sampai" defaultValue={filter.sampai} /></div>
      <div><label htmlFor="f-cabang">Cabang</label>
        <select id="f-cabang" className="fi" name="cabang" defaultValue={filter.cabang}><option value="">Semua cabang</option>{pilihan.cabang.map(c => <option key={c.id} value={c.id}>{c.nama}</option>)}</select></div>
      <div><label htmlFor="f-kategori">Kategori</label>
        <select id="f-kategori" className="fi" name="kategori" defaultValue={filter.kategori}><option value="">Semua kategori</option>{pilihan.kategori.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}</select></div>
      <div><label htmlFor="f-tingkat">Tingkat</label>
        <select id="f-tingkat" className="fi" name="tingkat" defaultValue={filter.tingkat}><option value="">Semua tingkat</option>{TINGKAT.map(t => <option key={t}>{t}</option>)}</select></div>
      <div><label htmlFor="f-status">Status</label>
        <select id="f-status" className="fi" name="status" defaultValue={filter.status}><option value="">Semua status</option><option value="terbuka">Belum ditutup</option><option value="ditutup">Sudah ditutup</option>{STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
      <div><label htmlFor="f-petugas">Petugas</label>
        <select id="f-petugas" className="fi" name="petugas" defaultValue={filter.petugas} disabled={pilihan.petugas.length === 0 && !filter.petugas}>
          <option value="">{pilihan.petugas.length === 0 && !filter.petugas ? "Pilih cabang dulu" : "Semua petugas"}</option>
          {pilihan.petugas.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}</select></div>
      <div><label htmlFor="f-kanal">Asal komplain</label>
        <select id="f-kanal" className="fi" name="kanal" defaultValue={filter.kanal}><option value="">Semua asal</option>{KANAL.map(t => <option key={t}>{t}</option>)}</select></div>
      {urut && <div><label htmlFor="f-q">Cari</label><input id="f-q" className="fi" type="search" name="q" defaultValue={filter.q} placeholder="Nomor, nama, telepon, isi" maxLength={80} /></div>}
      {urut && <div><label htmlFor="f-urut">Urutan</label>
        <select id="f-urut" className="fi" name="urut" defaultValue={filter.urut}><option value="terbaru">Terbaru dulu</option><option value="umur">Belum ditutup, tertua dulu</option><option value="nomor">Nomor terbesar</option></select></div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="btn-acc"><i className="ti ti-filter" /> Terapkan</button>
        <Link href={aksi} prefetch={false} className="btn-def" style={{ textDecoration: "none" }}>Atur ulang</Link>
      </div>
    </form>
  );
}

export function TabelKomplain({ baris, kosong = "Belum ada komplain yang cocok." }: { baris: BarisKomplain[]; kosong?: string }) {
  if (baris.length === 0) return <div className={s.kosong}>{kosong}</div>;
  return (
    <div className={s.tabel}>
      <table className="tbl">
        <thead><tr><th>Nomor</th><th>Tanggal</th><th>Cabang</th><th>Pelanggan</th><th>Kategori</th><th>Tingkat</th><th>Status</th><th>Petugas</th><th>Umur</th></tr></thead>
        <tbody>
          {baris.map(b => (
            <tr key={b.id} className={s.baris}>
              <td data-label="Nomor"><Link href={`/crm/komplain/${b.id}`} prefetch={false} style={{ fontWeight: 600 }}>{b.nomor}</Link></td>
              <td data-label="Tanggal">{tanggalPendek(b.tanggal)}</td>
              <td data-label="Cabang">{b.cabang ?? "—"}</td>
              <td data-label="Pelanggan">{b.nama ?? "—"}{b.hewan ? ` · ${b.hewan}` : ""}</td>
              <td data-label="Kategori">{b.kategori ?? "—"}</td>
              <td data-label="Tingkat"><LencanaTingkat tingkat={b.tingkat} /></td>
              <td data-label="Status"><LencanaStatus status={b.status} /></td>
              <td data-label="Petugas">{b.petugas ?? "—"}</td>
              <td data-label="Umur" style={{ color: b.terlambat ? "#b91c1c" : undefined, fontWeight: b.terlambat ? 600 : undefined }}>{teksUmur(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HalamanKomplain({ filter, hasil, path }: { filter: FilterKomplain; hasil: HasilDaftar; path: string }) {
  const jumlahHal = Math.max(1, Math.ceil(hasil.total / UKURAN_HALAMAN));
  return (
    <>
      <div className={s.meta} style={{ margin: "0 0 6px" }}>{hasil.total.toLocaleString("id-ID")} komplain · halaman {filter.hal} dari {jumlahHal}</div>
      <div className="card"><TabelKomplain baris={hasil.baris} /></div>
      {jumlahHal > 1 && (
        <div className={s.aksi}>
          {filter.hal > 1 && <Link className="btn-def" style={{ textDecoration: "none" }} prefetch={false} href={tautanFilter(path, filter, { hal: filter.hal - 1 })}>← Sebelumnya</Link>}
          {filter.hal < jumlahHal && <Link className="btn-def" style={{ textDecoration: "none" }} prefetch={false} href={tautanFilter(path, filter, { hal: filter.hal + 1 })}>Berikutnya →</Link>}
        </div>
      )}
    </>
  );
}
