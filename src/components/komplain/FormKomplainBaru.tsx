"use client";

// Formulir "Catat komplain". Semua isian dikirim ke aksi server -> RPC komplain_buat (hak dan cabang diperiksa database). Tidak menyentuh uang/stok.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LampiranPicker } from "@/components/LampiranPicker";
import { NumberInput } from "@/components/NumberInput";
import { PelangganPicker } from "@/components/PelangganPicker";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { muatPelanggan } from "@/components/useCariPelanggan";
import { buatKomplainAksi, petugasCabangAksi } from "@/app/(app)/crm/komplain/actions";
import { JENIS_REFERENSI, KANAL, TINGKAT, kunciPermintaan, lampiranAman, periksaBaru, type Pilihan } from "@/lib/komplain";
import type { PelangganDasar } from "@/lib/pelanggan-cari";
import s from "./komplain.module.css";

type Hewan = { id: string; name: string; species: string | null };
type Petugas = { id: string; nama: string; peran: string };

export function FormKomplainBaru({ pilihan, karyawan, hari }: { pilihan: Pilihan; karyawan: { id: string; nama: string; jabatan: string | null }[]; hari: string }) {
  const router = useRouter();
  const kunci = useRef(kunciPermintaan());
  const [cabang, setCabang] = useState(pilihan.cabang.length === 1 ? pilihan.cabang[0].id : "");
  const [pelanggan, setPelanggan] = useState<PelangganDasar | null>(null);
  const [nama, setNama] = useState(""); const [telepon, setTelepon] = useState("");
  const [hewan, setHewan] = useState<Hewan[]>([]); const [hewanId, setHewanId] = useState("");
  const [petugas, setPetugas] = useState<Petugas[]>([]); const [petugasId, setPetugasId] = useState("");
  const [terlibat, setTerlibat] = useState<string[]>([]);
  const [galat, setGalat] = useState(""); const [kirim, setKirim] = useState(false);

  useEffect(() => {
    let batal = false;
    if (!cabang) return;
    petugasCabangAksi(cabang).then(r => { if (!batal) setPetugas(r.ok ? r.petugas : []); }).catch(() => { if (!batal) setPetugas([]); });
    return () => { batal = true; };
  }, [cabang]);

  async function pilihPelanggan(p: PelangganDasar | null) {
    setPelanggan(p); setHewanId(""); setHewan([]);
    if (!p) return;
    setNama(p.name); setTelepon(p.phone);
    try { const d = await muatPelanggan<{ pets: Hewan[] }>(p.id, "pos"); setHewan(d?.pets ?? []); } catch { setHewan([]); }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (kirim) return;
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "");
    const isian = { cabang, kanal: v("kanal"), kategori: v("kategori"), tingkat: v("tingkat"), deskripsi: v("deskripsi"), ref_jenis: v("ref_jenis"), ref_nomor: v("ref_nomor"), tanggal: v("tanggal"), nominal: v("nominal") };
    const salah = periksaBaru(isian, hari);
    if (salah) { setGalat(salah); return; }
    let lampiran: unknown = [];
    try { lampiran = JSON.parse(v("lampiran") || "[]"); } catch { lampiran = []; }
    setGalat(""); setKirim(true);
    const h = await buatKomplainAksi({
      kunci: kunci.current, cabang, kanal: isian.kanal, tanggal: isian.tanggal, pelangganId: pelanggan?.id ?? null, hewanId: hewanId || null, nama, telepon,
      refJenis: isian.ref_jenis, refNomor: isian.ref_nomor, kategori: isian.kategori, tingkat: isian.tingkat, deskripsi: isian.deskripsi, harapan: v("harapan"),
      karyawan: terlibat, nominal: isian.nominal, petugas: petugasId || null, lampiran: lampiranAman(lampiran),
    });
    if (!h.ok) { setGalat(h.pesan); setKirim(false); return; }
    router.push(`/crm/komplain/${h.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="card" aria-label="Catat komplain pelanggan">
      <div className={s.grid2}>
        <div className="fg"><label className="flab" htmlFor="k-cabang">Cabang *</label>
          <select id="k-cabang" className="fi" value={cabang} onChange={e => { setCabang(e.target.value); setPetugasId(""); }} required>
            <option value="" disabled>Pilih cabang</option>{pilihan.cabang.map(c => <option key={c.id} value={c.id}>{c.nama}</option>)}</select></div>
        <div className="fg"><label className="flab" htmlFor="k-kanal">Asal komplain *</label>
          <select id="k-kanal" className="fi" name="kanal" defaultValue="" required><option value="" disabled>Pilih asal</option>{KANAL.map(k => <option key={k}>{k}</option>)}</select></div>
        <div className="fg"><label className="flab" htmlFor="k-tanggal">Tanggal komplain <span style={{ color: "var(--tm)" }}>(kosong = sekarang)</span></label>
          <input id="k-tanggal" className="fi" type="date" name="tanggal" max={hari} /></div>
        <div className="fg"><label className="flab" htmlFor="k-kategori">Kategori *</label>
          <select id="k-kategori" className="fi" name="kategori" defaultValue="" required><option value="" disabled>Pilih kategori</option>{pilihan.kategori.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}</select></div>
        <div className="fg"><label className="flab" htmlFor="k-tingkat">Tingkat keparahan *</label>
          <select id="k-tingkat" className="fi" name="tingkat" defaultValue="Sedang" required>{TINGKAT.map(t => <option key={t}>{t}</option>)}</select></div>
        <div className="fg"><label className="flab" htmlFor="k-petugas">Ditugaskan ke <span style={{ color: "var(--tm)" }}>(boleh kosong)</span></label>
          <select id="k-petugas" className="fi" value={petugasId} onChange={e => setPetugasId(e.target.value)} disabled={!cabang}>
            <option value="">{cabang ? "Belum ditugaskan" : "Pilih cabang dulu"}</option>{petugas.map(p => <option key={p.id} value={p.id}>{p.nama} ({p.peran})</option>)}</select></div>
      </div>

      <div className={s.bagian}>
        <div className="flab">Pelanggan <span style={{ color: "var(--tm)" }}>(boleh dilewati — cari yang sudah terdaftar, atau ketik nama dan telepon)</span></div>
        <PelangganPicker name="customer_id" onPilih={pilihPelanggan} />
        <div className={s.grid2} style={{ marginTop: 8 }}>
          <div className="fg"><label className="flab" htmlFor="k-nama">Nama pelanggan</label><input id="k-nama" className="fi" value={nama} onChange={e => setNama(e.target.value)} maxLength={120} /></div>
          <div className="fg"><label className="flab" htmlFor="k-telepon">No. HP</label><input id="k-telepon" className="fi" value={telepon} onChange={e => setTelepon(e.target.value)} maxLength={40} inputMode="tel" /></div>
          <div className="fg"><label className="flab" htmlFor="k-hewan">Hewan</label>
            <select id="k-hewan" className="fi" value={hewanId} onChange={e => setHewanId(e.target.value)} disabled={hewan.length === 0}>
              <option value="">{pelanggan ? (hewan.length ? "Tidak spesifik" : "Belum ada hewan terdaftar") : "Pilih pelanggan dulu"}</option>{hewan.map(h => <option key={h.id} value={h.id}>{h.name}{h.species ? ` (${h.species})` : ""}</option>)}</select></div>
        </div>
        <div className={s.grid2}>
          <div className="fg"><label className="flab" htmlFor="k-refj">Dokumen terkait <span style={{ color: "var(--tm)" }}>(invoice / struk, opsional)</span></label>
            <select id="k-refj" className="fi" name="ref_jenis" defaultValue=""><option value="">Tidak ada</option>{JENIS_REFERENSI.map(j => <option key={j}>{j}</option>)}</select></div>
          <div className="fg"><label className="flab" htmlFor="k-refn">Nomor dokumen</label><input id="k-refn" className="fi" name="ref_nomor" maxLength={60} placeholder="mis. INV-2026-0123 / nomor struk" /></div>
        </div>
      </div>

      <div className="fg"><label className="flab" htmlFor="k-deskripsi">Isi komplain *</label>
        <textarea id="k-deskripsi" className="fi" name="deskripsi" rows={4} required minLength={5} maxLength={4000} placeholder="Apa yang dikeluhkan pelanggan, kapan, dan siapa yang terlibat." /></div>
      <div className="fg"><label className="flab" htmlFor="k-harapan">Harapan pelanggan <span style={{ color: "var(--tm)" }}>(opsional)</span></label>
        <textarea id="k-harapan" className="fi" name="harapan" rows={2} maxLength={1000} placeholder="mis. minta uang kembali, minta diganti barang, cukup minta maaf" /></div>
      <div className={s.grid2}>
        <div className="fg"><label className="flab" htmlFor="k-nominal">Nilai yang dipermasalahkan (Rp) <span style={{ color: "var(--tm)" }}>(opsional)</span></label>
          <NumberInput id="k-nominal" className="fi" name="nominal" type="number" min={0} step="any" placeholder="0" /></div>
      </div>
      <div className="fg"><div className="flab">Karyawan yang terlibat <span style={{ color: "var(--tm)" }}>(opsional)</span></div>
        <SearchableMultiSelect name="karyawan" label="karyawan" options={karyawan.map(k => ({ id: k.id, name: k.nama, code: k.jabatan ?? "" }))} value={terlibat} onChange={setTerlibat} /></div>
      <div className="fg"><div className="flab">Foto / tangkapan layar <span style={{ color: "var(--tm)" }}>(opsional)</span></div>
        <LampiranPicker folder="komplain" /></div>

      {galat && <div className={s.galat} role="alert">{galat}</div>}
      <div className={s.aksi}>
        <button type="submit" className="btn-acc" disabled={kirim}><i className="ti ti-device-floppy" /> {kirim ? "Menyimpan…" : "Simpan komplain"}</button>
      </div>
    </form>
  );
}
