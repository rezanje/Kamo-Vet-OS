"use client";

// Kelola kategori komplain dan batas "terlambat". Hanya Owner / pemegang izin kelola yang bisa menyimpan (database menegakkan); yang lain melihat daftar saja.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { simpanBatasTelatKomplainAksi, simpanKategoriKomplainAksi } from "@/app/(app)/crm/komplain/actions";
import type { HasilKategori } from "@/lib/komplain";
import s from "./komplain.module.css";

function BarisKategori({ k, kelola }: { k: HasilKategori["kategori"][number]; kelola: boolean }) {
  const router = useRouter();
  const [nama, setNama] = useState(k.nama); const [urut, setUrut] = useState(String(k.urut)); const [aktif, setAktif] = useState(k.aktif);
  const [galat, setGalat] = useState(""); const [kirim, setKirim] = useState(false);
  const berubah = nama.trim() !== k.nama || Number(urut) !== k.urut || aktif !== k.aktif;
  async function simpan() {
    setKirim(true); setGalat("");
    const h = await simpanKategoriKomplainAksi({ id: k.id, nama, urut: Number.isInteger(Number(urut)) ? Number(urut) : null, aktif });
    setKirim(false);
    if (!h.ok) { setGalat(h.pesan); return; }
    router.refresh();
  }
  return (
    <tr>
      <td data-label="Nama"><input className="fi" value={nama} onChange={e => setNama(e.target.value)} disabled={!kelola} maxLength={60} aria-label={`Nama kategori ${k.nama}`} /></td>
      <td data-label="Urutan"><input className="fi" value={urut} onChange={e => setUrut(e.target.value)} disabled={!kelola} inputMode="numeric" style={{ maxWidth: 80 }} aria-label={`Urutan ${k.nama}`} /></td>
      <td data-label="Aktif"><input type="checkbox" checked={aktif} onChange={e => setAktif(e.target.checked)} disabled={!kelola} aria-label={`Aktif ${k.nama}`} /></td>
      <td data-label="Dipakai">{k.dipakai}</td>
      <td data-label="">{kelola && <button type="button" className="btn-def" onClick={simpan} disabled={!berubah || kirim}>{kirim ? "…" : "Simpan"}</button>}{galat && <div className={s.galat} role="alert">{galat}</div>}</td>
    </tr>
  );
}

export function KategoriEditor({ data }: { data: HasilKategori }) {
  const router = useRouter();
  const [baru, setBaru] = useState(""); const [hari, setHari] = useState(String(data.hari_telat));
  const [galat, setGalat] = useState(""); const [sukses, setSukses] = useState(""); const [kirim, setKirim] = useState(false);
  async function tambah(e: React.FormEvent) {
    e.preventDefault(); if (kirim) return;
    setKirim(true); setGalat(""); setSukses("");
    const h = await simpanKategoriKomplainAksi({ id: null, nama: baru, urut: null, aktif: true });
    setKirim(false);
    if (!h.ok) { setGalat(h.pesan); return; }
    setBaru(""); setSukses("Kategori ditambahkan."); router.refresh();
  }
  async function simpanHari(e: React.FormEvent) {
    e.preventDefault(); if (kirim) return;
    setKirim(true); setGalat(""); setSukses("");
    const h = await simpanBatasTelatKomplainAksi(Number(hari));
    setKirim(false);
    if (!h.ok) { setGalat(h.pesan); return; }
    setSukses("Batas terlambat tersimpan."); router.refresh();
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!data.kelola && <div className={s.catatan}>Daftar ini hanya bisa dilihat. Menambah/mengubah kategori dan batas terlambat hanya untuk Owner atau akun yang diberi izin &quot;Kelola semua komplain pelanggan&quot; di Akses Grup (CRM).</div>}
      <div className="card">
        <div className="card-hd"><i className="ti ti-category" /> Kategori komplain</div>
        <div className={s.tabel}>
          <table className="tbl"><thead><tr><th>Nama</th><th>Urutan</th><th>Aktif</th><th>Dipakai</th><th /></tr></thead>
            <tbody>{data.kategori.map(k => <BarisKategori key={`${k.id}:${k.nama}:${k.urut}:${k.aktif}`} k={k} kelola={data.kelola} />)}</tbody></table>
        </div>
        <div className={s.meta}>Kategori tidak dihapus: yang tidak dipakai lagi dinonaktifkan (komplain lama tetap menampilkannya).</div>
        {data.kelola && (
          <form onSubmit={tambah} className={s.aksi} aria-label="Tambah kategori">
            <input className="fi" style={{ maxWidth: 320 }} value={baru} onChange={e => setBaru(e.target.value)} placeholder="Nama kategori baru" maxLength={60} aria-label="Nama kategori baru" />
            <button type="submit" className="btn-acc" disabled={kirim || baru.trim().length < 2}><i className="ti ti-plus" /> Tambah kategori</button>
          </form>
        )}
      </div>
      <div className="card">
        <div className="card-hd"><i className="ti ti-clock-exclamation" /> Batas &quot;terlambat&quot;</div>
        <form onSubmit={simpanHari} className={s.aksi} aria-label="Batas terlambat">
          <label htmlFor="b-hari" className="flab" style={{ margin: 0 }}>Komplain terbuka lebih dari</label>
          <input id="b-hari" className="fi" style={{ maxWidth: 80 }} value={hari} onChange={e => setHari(e.target.value)} disabled={!data.kelola} inputMode="numeric" />
          <span style={{ fontSize: 12.5 }}>hari dianggap terlambat</span>
          {data.kelola && <button type="submit" className="btn-def" disabled={kirim}>Simpan</button>}
        </form>
      </div>
      {galat && <div className={s.galat} role="alert">{galat}</div>}{sukses && <div className={s.sukses} role="status">{sukses}</div>}
    </div>
  );
}
