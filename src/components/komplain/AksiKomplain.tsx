"use client";

// Panel penanganan satu komplain: ubah status (menutup wajib catatan + jenis penyelesaian), catatan + lampiran, ubah rincian. Hak ditegakkan database;
// tombol hanya muncul sesuai `boleh` dari komplain_detail. Refund/ganti barang hanya DICATAT di sini — uangnya lewat layar refund/koreksi yang ada.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LampiranPicker } from "@/components/LampiranPicker";
import { NumberInput } from "@/components/NumberInput";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { petugasCabangAksi, tambahCatatanKomplainAksi, ubahDetailKomplainAksi, ubahStatusKomplainAksi } from "@/app/(app)/crm/komplain/actions";
import { JENIS_PENYELESAIAN, JENIS_REFERENSI, TINGKAT, adalahTutup, kunciPermintaan, lampiranAman, periksaStatus, statusBerikut, type DetailKomplain, type HasilAksiUi, type Pilihan } from "@/lib/komplain";
import s from "./komplain.module.css";

type Petugas = { id: string; nama: string; peran: string };

function Pesan({ galat, sukses }: { galat: string; sukses: string }) {
  return <>{galat && <div className={s.galat} role="alert">{galat}</div>}{sukses && <div className={s.sukses} role="status">{sukses}</div>}</>;
}

function FormStatus({ d }: { d: DetailKomplain }) {
  const router = useRouter();
  const k = d.komplain; const buka = adalahTutup(k.status);
  const pilihan = statusBerikut(k.status);
  const kunci = useRef(kunciPermintaan());
  const [tujuan, setTujuan] = useState(""); const [catatan, setCatatan] = useState(""); const [jenis, setJenis] = useState("");
  const [galat, setGalat] = useState(""); const [sukses, setSukses] = useState(""); const [kirim, setKirim] = useState(false);
  const tutup = adalahTutup(tujuan);
  async function kirimStatus(e: React.FormEvent) {
    e.preventDefault(); if (kirim) return;
    const salah = periksaStatus(tujuan, catatan, jenis) ?? (buka && catatan.trim().length < 5 ? "Tulis alasan membuka kembali (minimal 5 huruf)." : null);
    if (salah) { setGalat(salah); setSukses(""); return; }
    setGalat(""); setKirim(true);
    const h: HasilAksiUi = await ubahStatusKomplainAksi({ kunci: kunci.current, id: k.id, status: tujuan, catatan, jenis: tutup ? jenis : "" });
    setKirim(false);
    if (!h.ok) { setGalat(h.pesan); return; }
    kunci.current = kunciPermintaan(); setSukses(h.sudahAda ? "Perubahan itu sudah tersimpan sebelumnya." : "Status tersimpan."); setTujuan(""); setCatatan(""); setJenis("");
    router.refresh();
  }
  return (
    <form onSubmit={kirimStatus} className="card" aria-label={buka ? "Buka kembali komplain" : "Ubah status komplain"}>
      <div className="card-hd"><i className="ti ti-arrows-exchange" /> {buka ? "Buka kembali komplain" : "Ubah status"}</div>
      <div className={s.grid2}>
        <div className="fg"><label className="flab" htmlFor="s-tujuan">{buka ? "Status baru" : "Pindah ke"}</label>
          <select id="s-tujuan" className="fi" value={tujuan} onChange={e => { setTujuan(e.target.value); setJenis(""); }} required>
            <option value="" disabled>Pilih status</option>{pilihan.map(p => <option key={p}>{p}</option>)}</select></div>
        {tutup && <div className="fg"><label className="flab" htmlFor="s-jenis">Jenis penyelesaian *</label>
          <select id="s-jenis" className="fi" value={jenis} onChange={e => setJenis(e.target.value)} required>
            <option value="" disabled>Pilih jenis</option>{JENIS_PENYELESAIAN.filter(j => (tujuan === "Ditolak") === (j === "Tidak valid")).map(j => <option key={j}>{j}</option>)}</select></div>}
      </div>
      <div className="fg"><label className="flab" htmlFor="s-catatan">{tutup ? "Catatan penyelesaian *" : buka ? "Alasan membuka kembali *" : "Catatan (opsional)"}</label>
        <textarea id="s-catatan" className="fi" rows={3} value={catatan} onChange={e => setCatatan(e.target.value)} maxLength={4000}
          placeholder={tutup ? "Apa yang sudah dilakukan / dijelaskan ke pelanggan. Refund atau ganti barang: tulis nomor dokumennya (uang diproses lewat layar refund/koreksi)." : ""} /></div>
      <Pesan galat={galat} sukses={sukses} />
      <div className={s.aksi}><button type="submit" className="btn-acc" disabled={kirim || !tujuan}>{kirim ? "Menyimpan…" : buka ? "Buka kembali" : tutup ? "Tutup komplain" : "Simpan status"}</button></div>
    </form>
  );
}

function FormCatatan({ d }: { d: DetailKomplain }) {
  const router = useRouter();
  const kunci = useRef(kunciPermintaan());
  const [catatan, setCatatan] = useState(""); const [galat, setGalat] = useState(""); const [sukses, setSukses] = useState(""); const [kirim, setKirim] = useState(false);
  const [ulang, setUlang] = useState(0);
  async function kirimCatatan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (kirim) return;
    let lampiran: unknown = [];
    try { lampiran = JSON.parse(String(new FormData(e.currentTarget).get("lampiran") ?? "[]")); } catch { lampiran = []; }
    const berkas = lampiranAman(lampiran);
    if (catatan.trim().length < 2 && berkas.length === 0) { setGalat("Tulis catatan atau lampirkan berkas."); setSukses(""); return; }
    setGalat(""); setKirim(true);
    const h: HasilAksiUi = await tambahCatatanKomplainAksi({ kunci: kunci.current, id: d.komplain.id, catatan, lampiran: berkas });
    setKirim(false);
    if (!h.ok) { setGalat(h.pesan); return; }
    kunci.current = kunciPermintaan(); setCatatan(""); setUlang(n => n + 1); setSukses("Catatan tersimpan.");
    router.refresh();
  }
  return (
    <form onSubmit={kirimCatatan} className="card" aria-label="Tambah catatan">
      <div className="card-hd"><i className="ti ti-notes" /> Tambah catatan / lampiran</div>
      <div className="fg"><textarea className="fi" rows={3} value={catatan} onChange={e => setCatatan(e.target.value)} maxLength={4000} aria-label="Catatan" placeholder="mis. pelanggan sudah dihubungi lewat WhatsApp" /></div>
      <div className="fg" key={ulang}><LampiranPicker folder="komplain" /></div>
      <Pesan galat={galat} sukses={sukses} />
      <div className={s.aksi}><button type="submit" className="btn-def" disabled={kirim}>{kirim ? "Menyimpan…" : "Simpan catatan"}</button></div>
    </form>
  );
}

function FormRincian({ d, pilihan, karyawan }: { d: DetailKomplain; pilihan: Pilihan; karyawan: { id: string; nama: string; jabatan: string | null }[] }) {
  const router = useRouter();
  const k = d.komplain;
  const kunci = useRef(kunciPermintaan());
  const [kategori, setKategori] = useState(k.kategori_id); const [tingkat, setTingkat] = useState(k.tingkat); const [petugasId, setPetugasId] = useState(k.petugas_id ?? "");
  const [terlibat, setTerlibat] = useState<string[]>(k.karyawan.map(x => x.id)); const [nominal, setNominal] = useState(k.nominal == null ? "" : String(k.nominal));
  const [harapan, setHarapan] = useState(k.harapan ?? ""); const [refJenis, setRefJenis] = useState(k.ref_jenis ?? ""); const [refNomor, setRefNomor] = useState(k.ref_nomor ?? "");
  const [alasan, setAlasan] = useState(""); const [petugas, setPetugas] = useState<Petugas[]>([]);
  const [galat, setGalat] = useState(""); const [sukses, setSukses] = useState(""); const [kirim, setKirim] = useState(false);
  useEffect(() => {
    let batal = false;
    petugasCabangAksi(k.cabang_id).then(r => { if (!batal) setPetugas(r.ok ? r.petugas : []); }).catch(() => { if (!batal) setPetugas([]); });
    return () => { batal = true; };
  }, [k.cabang_id]);
  const petugasSekarang = k.petugas_id && !petugas.some(p => p.id === k.petugas_id) ? [{ id: k.petugas_id, nama: k.petugas ?? "Petugas", peran: "" }] : [];
  const kategoriPilihan = pilihan.kategori.some(x => x.id === k.kategori_id) ? pilihan.kategori : [...pilihan.kategori, { id: k.kategori_id, nama: k.kategori ?? "Kategori" }];
  const opsiKaryawan = [...karyawan.map(x => ({ id: x.id, name: x.nama, code: x.jabatan ?? "" })), ...k.karyawan.filter(x => !karyawan.some(y => y.id === x.id)).map(x => ({ id: x.id, name: x.name, code: "" }))];
  async function simpan(e: React.FormEvent) {
    e.preventDefault(); if (kirim) return;
    if (alasan.trim().length < 3) { setGalat("Tulis alasan perubahan (minimal 3 huruf)."); setSukses(""); return; }
    if (Boolean(refJenis) !== Boolean(refNomor.trim())) { setGalat("Isi jenis dan nomor dokumen bersama-sama, atau kosongkan keduanya."); return; }
    setGalat(""); setKirim(true);
    const h: HasilAksiUi = await ubahDetailKomplainAksi({ kunci: kunci.current, id: k.id, kategori, tingkat, petugas: petugasId || null, karyawan: terlibat, nominal, harapan, refJenis, refNomor, catatan: alasan });
    setKirim(false);
    if (!h.ok) { setGalat(h.pesan); return; }
    kunci.current = kunciPermintaan(); setAlasan(""); setSukses(h.sudahAda ? "Perubahan itu sudah tersimpan sebelumnya." : "Rincian tersimpan.");
    router.refresh();
  }
  return (
    <details className="card">
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}><i className="ti ti-edit" /> Ubah rincian / petugas</summary>
      <form onSubmit={simpan} aria-label="Ubah rincian komplain" style={{ marginTop: 10 }}>
        <div className={s.grid2}>
          <div className="fg"><label className="flab" htmlFor="r-kategori">Kategori</label>
            <select id="r-kategori" className="fi" value={kategori} onChange={e => setKategori(e.target.value)}>{kategoriPilihan.map(x => <option key={x.id} value={x.id}>{x.nama}</option>)}</select></div>
          <div className="fg"><label className="flab" htmlFor="r-tingkat">Tingkat</label>
            <select id="r-tingkat" className="fi" value={tingkat} onChange={e => setTingkat(e.target.value)}>{TINGKAT.map(t => <option key={t}>{t}</option>)}</select></div>
          <div className="fg"><label className="flab" htmlFor="r-petugas">Petugas</label>
            <select id="r-petugas" className="fi" value={petugasId} onChange={e => setPetugasId(e.target.value)}><option value="">Belum ditugaskan</option>
              {[...petugasSekarang, ...petugas].map(p => <option key={p.id} value={p.id}>{p.nama}{p.peran ? ` (${p.peran})` : ""}</option>)}</select></div>
          <div className="fg"><label className="flab" htmlFor="r-nominal">Nilai (Rp)</label>
            <NumberInput id="r-nominal" className="fi" type="number" min={0} step="any" value={nominal} onChange={e => setNominal(e.target.value)} /></div>
          <div className="fg"><label className="flab" htmlFor="r-refj">Jenis dokumen</label>
            <select id="r-refj" className="fi" value={refJenis} onChange={e => setRefJenis(e.target.value)}><option value="">Tidak ada</option>{JENIS_REFERENSI.map(j => <option key={j}>{j}</option>)}</select></div>
          <div className="fg"><label className="flab" htmlFor="r-refn">Nomor dokumen</label><input id="r-refn" className="fi" value={refNomor} onChange={e => setRefNomor(e.target.value)} maxLength={60} /></div>
        </div>
        <div className="fg"><label className="flab" htmlFor="r-harapan">Harapan pelanggan</label><textarea id="r-harapan" className="fi" rows={2} value={harapan} onChange={e => setHarapan(e.target.value)} maxLength={1000} /></div>
        <div className="fg"><div className="flab">Karyawan yang terlibat</div>
          <SearchableMultiSelect name="karyawan-ubah" label="karyawan" options={opsiKaryawan} value={terlibat} onChange={setTerlibat} /></div>
        <div className="fg"><label className="flab" htmlFor="r-alasan">Alasan perubahan *</label><input id="r-alasan" className="fi" value={alasan} onChange={e => setAlasan(e.target.value)} maxLength={4000} /></div>
        <Pesan galat={galat} sukses={sukses} />
        <div className={s.aksi}><button type="submit" className="btn-def" disabled={kirim}>{kirim ? "Menyimpan…" : "Simpan perubahan"}</button></div>
      </form>
    </details>
  );
}

export function AksiKomplain({ detail, pilihan, karyawan }: { detail: DetailKomplain; pilihan: Pilihan; karyawan: { id: string; nama: string; jabatan: string | null }[] }) {
  const { boleh } = detail; const tutup = adalahTutup(detail.komplain.status);
  return (
    <div className={s.bagian} style={{ display: "grid", gap: 12 }}>
      {!tutup && boleh.ubah && <FormStatus d={detail} />}
      {tutup && boleh.buka_kembali && <FormStatus d={detail} />}
      {tutup && !boleh.buka_kembali && <div className={s.catatan}>Komplain ini sudah ditutup. Hanya Owner atau pemegang izin kelola komplain yang bisa membukanya kembali.</div>}
      {boleh.catatan && <FormCatatan d={detail} />}
      {boleh.ubah && <FormRincian d={detail} pilihan={pilihan} karyawan={karyawan} />}
      {!tutup && !boleh.ubah && <div className={s.catatan}>Anda boleh melihat dan menambah catatan. Mengubah status/rincian hanya untuk pembuat, petugas, atau pemegang izin kelola.</div>}
    </div>
  );
}
