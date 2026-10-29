"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FolderDropZone } from "@/components/FolderDropZone";
import {
  prosesPotonganImporRekamMedis,
  type HasilPotonganImporRekamMedis,
  type RekamMedisIdentityDecision,
} from "./actions";
import type {
  RekamMedisIdentityClarification,
  RekamMedisImporHeld,
  RekamMedisImporRow,
} from "@/lib/impor-rekam-medis";
import {
  BATAS_POTONGAN_AWAL,
  bacaTitikSimpan,
  bagiKirimanBaris,
  csvRiwayatDitahan,
  hapusTitikSimpan,
  HITUNGAN_IMPOR_KOSONG,
  kirimDenganUlangan,
  labelTombolAliran,
  namaBerkasCatatanDitahan,
  PelacakGandaRiwayat,
  perkiraanSisaWaktuImpor,
  rencanakanPotonganImpor,
  saringGandaPotongan,
  sesuaikanBatasPotongan,
  sisakanFolderBelumSelesai,
  tandaRuangImpor,
  teksProgresImpor,
  tulisTitikSimpan,
  type BatasPotonganImpor,
  type HitunganImporRekamMedis,
  type PotonganImporRekamMedis,
  type StatusAliranImpor,
} from "@/lib/impor-rekam-medis-aliran";
import {
  BATAS_BYTES_BERKAS_REKAM_MEDIS,
  sumberFolderLokal,
  gabungBerkasPilihan,
  daftarFolderUtama,
  type FolderImporRekamMedis,
  type SumberImporRekamMedis,
} from "@/lib/impor-rekam-medis-sumber";
import { buatPenguraiKartuMedis, type PenguraiKartuMedis } from "@/lib/impor-rekam-medis-pengurai";

/** Batas tampilan dan memori: impor besar tidak boleh menumpuk isi medis di tab. */
const MAKS_DITAHAN_DISIMPAN = 20_000;
const MAKS_PERTANYAAN_DISIMPAN = 2_000;
const MAKS_BARIS_TAMPIL = 200;

type Antrian = {
  folders: FolderImporRekamMedis[];
  iFolder: number;
  iPotongan: number;
  /** Rencana potongan folder berjalan; disimpan supaya jeda-lanjut tidak melewati berkas. */
  potongan: PotonganImporRekamMedis[] | null;
  ruang: string;
  /** Folder yang sudah tercatat selesai SEBELUM sesi ini; tetap ikut ditulis ulang. */
  selesaiAwal: string[];
  berkasTotal: number;
};

function kunciPilihan(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID").replace(/[.:]/g, "").replace(/\s+/g, " ");
}

function penyimpanLokal() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function keputusanKePayload(keputusan: Record<string, string>): RekamMedisIdentityDecision[] {
  return Object.entries(keputusan).flatMap(([source_key, pilihan]): RekamMedisIdentityDecision[] => {
    if (pilihan === "skip") return [{ source_key, decision: "skip" }];
    try {
      const parsed = JSON.parse(pilihan) as { customer_id?: unknown; pet_id?: unknown };
      if (typeof parsed.customer_id !== "string") return [];
      return [{ source_key, decision: { customer_id: parsed.customer_id, pet_id: typeof parsed.pet_id === "string" ? parsed.pet_id : null } }];
    } catch {
      return [];
    }
  });
}

export function RekamMedisImportForm() {
  const [berkasTerpilih, setBerkasTerpilih] = useState<File[]>([]);
  const [status, setStatus] = useState<StatusAliranImpor>("siap");
  const [setuju, setSetuju] = useState(false);
  const [hitungan, setHitungan] = useState<HitunganImporRekamMedis>(HITUNGAN_IMPOR_KOSONG);
  const [folderSelesai, setFolderSelesai] = useState(0);
  const [folderTotal, setFolderTotal] = useState(0);
  const [sisaMs, setSisaMs] = useState<number | null>(null);
  const [ditahan, setDitahan] = useState<RekamMedisImporHeld[]>([]);
  const [pertanyaan, setPertanyaan] = useState<RekamMedisIdentityClarification[]>([]);
  const [keputusan, setKeputusan] = useState<Record<string, string>>({});
  const [pesan, setPesan] = useState("");
  const [error, setError] = useState("");
  const [menyimpanKeputusan, setMenyimpanKeputusan] = useState(false);
  const [membacaFolder, setMembacaFolder] = useState(false);

  const antrianRef = useRef<Antrian | null>(null);
  const sumberRef = useRef<SumberImporRekamMedis | null>(null);
  const penguraiRef = useRef<PenguraiKartuMedis | null>(null);
  const pelacakRef = useRef(new PelacakGandaRiwayat());
  const batasRef = useRef<BatasPotonganImpor>(BATAS_POTONGAN_AWAL);
  const jedaRef = useRef(false);
  const berjalanRef = useRef(false);
  const waktuRef = useRef({ terpakaiMs: 0, berkas: 0 });
  const tertundaRef = useRef(new Map<string, RekamMedisImporRow>());
  const ditahanRef = useRef<RekamMedisImporHeld[]>([]);

  const progres = useMemo(
    () => teksProgresImpor(status, { selesai: folderSelesai, total: folderTotal }, hitungan, sisaMs),
    [status, folderSelesai, folderTotal, hitungan, sisaMs],
  );
  const pertanyaanTerjawab = pertanyaan.every((item) => Boolean(keputusan[item.source_key]));

  const catatDitahan = useCallback((rows: RekamMedisImporHeld[]) => {
    if (!rows.length) return;
    const sisa = Math.max(0, MAKS_DITAHAN_DISIMPAN - ditahanRef.current.length);
    if (sisa > 0) ditahanRef.current.push(...rows.slice(0, sisa));
    setDitahan([...ditahanRef.current]);
    setHitungan((current) => ({ ...current, ditahan: current.ditahan + rows.length }));
  }, []);

  const pilihBerkas = (daftar: File[]) => {
    penguraiRef.current?.tutup();
    penguraiRef.current = null;
    antrianRef.current = null;
    sumberRef.current = null;
    pelacakRef.current = new PelacakGandaRiwayat();
    tertundaRef.current = new Map();
    ditahanRef.current = [];
    batasRef.current = BATAS_POTONGAN_AWAL;
    waktuRef.current = { terpakaiMs: 0, berkas: 0 };
    jedaRef.current = false;
    setBerkasTerpilih(daftar);
    setStatus("siap");
    setHitungan(HITUNGAN_IMPOR_KOSONG);
    setFolderSelesai(0);
    setFolderTotal(0);
    setSisaMs(null);
    setDitahan([]);
    setPertanyaan([]);
    setKeputusan({});
    setPesan("");
    setError(daftar.length ? "" : "Folder tidak berisi kartu medis .xlsx.");
  };

  const prosesPotongan = useCallback(async (
    sumber: SumberImporRekamMedis,
    pengurai: PenguraiKartuMedis,
    potongan: PotonganImporRekamMedis,
    terakhir: boolean,
  ) => {
    const mulai = Date.now();
    const besar = potongan.berkas.filter((berkas) => berkas.ukuran > BATAS_BYTES_BERKAS_REKAM_MEDIS);
    const muat = potongan.berkas.filter((berkas) => berkas.ukuran <= BATAS_BYTES_BERKAS_REKAM_MEDIS);
    if (besar.length) {
      catatDitahan(besar.map((berkas) => ({
        source_key: `terlalu-besar::${berkas.jalur}`,
        source_file: berkas.nama,
        source_sheet: "—",
        reason: "File lebih dari 5 MB; pecah dulu kartunya lalu impor ulang",
      })));
    }
    if (!muat.length) return;

    const isi = [];
    for (const berkas of muat) isi.push({ fileName: berkas.nama, sourcePath: berkas.jalur, bytes: await sumber.bacaBerkas(berkas) });
    const hasil = await pengurai.urai(isi);
    isi.length = 0;

    if (hasil.held.length) catatDitahan(hasil.held);
    const { siap, ditahan: ganda } = saringGandaPotongan(hasil.rows, pelacakRef.current);
    if (ganda.length) catatDitahan(ganda);
    hasil.rows.length = 0;

    const kirimanSemua = bagiKirimanBaris(siap);
    for (let index = 0; index < kirimanSemua.length; index += 1) {
      const kiriman = kirimanSemua[index];
      const jawaban = await kirimDenganUlangan<HasilPotonganImporRekamMedis>(async () => {
        const hasilKirim = await prosesPotonganImporRekamMedis(kiriman, [], true, terakhir && index === kirimanSemua.length - 1);
        if (!hasilKirim.ok) throw new Error(hasilKirim.message);
        return hasilKirim;
      });
      // Pertanyaan identitas menahan barisnya di memori tab; batasi supaya impor sebesar
      // apa pun tidak menghabiskan RAM. Kelebihannya dicatat sebagai ditahan, bukan hilang.
      const muatPertanyaan = Math.max(0, MAKS_PERTANYAAN_DISIMPAN - tertundaRef.current.size);
      const barisPertanyaan = jawaban.perlu_keputusan.slice(0, muatPertanyaan);
      for (const item of barisPertanyaan) {
        const row = kiriman.find((candidate) => candidate.source_key === item.source_key);
        if (row) tertundaRef.current.set(item.source_key, row);
      }
      if (barisPertanyaan.length) setPertanyaan((current) => [...current, ...barisPertanyaan]);
      const luberPertanyaan = jawaban.perlu_keputusan.slice(muatPertanyaan);
      catatDitahan([...jawaban.ditahan, ...luberPertanyaan.map((item) => ({
        source_key: item.source_key,
        source_file: item.source_file,
        source_sheet: item.source_sheet,
        reason: "Pertanyaan identitas menumpuk; jawab yang sudah muncul lalu impor ulang folder ini",
      }))]);
      setHitungan((current) => ({
        ...current,
        tersimpan: current.tersimpan + jawaban.tersimpan,
        sudahAda: current.sudahAda + jawaban.sudah_ada,
        perluKeputusan: current.perluKeputusan + barisPertanyaan.length,
      }));
    }

    waktuRef.current = {
      terpakaiMs: waktuRef.current.terpakaiMs + (Date.now() - mulai),
      berkas: waktuRef.current.berkas + potongan.berkas.length,
    };
    // Batas baru berlaku mulai folder berikutnya; rencana folder berjalan tidak diubah
    // di tengah jalan supaya tidak ada berkas yang terlewat atau terkirim dua kali.
    batasRef.current = sesuaikanBatasPotongan(batasRef.current, { durasiMs: Date.now() - mulai });
  }, [catatDitahan]);

  const jalankan = useCallback(async () => {
    if (berjalanRef.current) return;
    berjalanRef.current = true;
    jedaRef.current = false;
    setError("");
    setStatus("berjalan");
    try {
      if (!antrianRef.current) {
        const sumber = sumberFolderLokal(berkasTerpilih);
        const semua = await sumber.daftarFolder();
        if (!semua.length) throw new Error("Folder tidak berisi kartu medis .xlsx.");
        const ruang = tandaRuangImpor(sumber.akar, semua);
        const sudah = bacaTitikSimpan(penyimpanLokal(), ruang);
        const sisa = sisakanFolderBelumSelesai(semua, sudah);
        sumberRef.current = sumber;
        const selesaiAwal = semua.filter((folder) => !sisa.includes(folder)).map((folder) => folder.id);
        antrianRef.current = {
          folders: sisa,
          iFolder: 0,
          iPotongan: 0,
          potongan: null,
          ruang,
          selesaiAwal,
          berkasTotal: sisa.reduce((jumlah, folder) => jumlah + folder.berkas.length, 0),
        };
        setFolderTotal(semua.length);
        setFolderSelesai(semua.length - sisa.length);
      }
      const antrian = antrianRef.current;
      const sumber = sumberRef.current;
      if (!sumber) throw new Error("Pilih ulang folder rekam medis.");
      penguraiRef.current ??= buatPenguraiKartuMedis();
      const pengurai = penguraiRef.current;

      while (antrian.iFolder < antrian.folders.length) {
        const folder = antrian.folders[antrian.iFolder];
        antrian.potongan ??= rencanakanPotonganImpor([folder], batasRef.current);
        const potongan = antrian.potongan;
        while (antrian.iPotongan < potongan.length) {
          if (jedaRef.current) {
            setStatus("jeda");
            return;
          }
          const terakhirFolder = antrian.iFolder === antrian.folders.length - 1 && antrian.iPotongan === potongan.length - 1;
          try {
            await prosesPotongan(sumber, pengurai, potongan[antrian.iPotongan], terakhirFolder);
          } catch (cause) {
            batasRef.current = sesuaikanBatasPotongan(batasRef.current, { gagal: true });
            throw cause;
          }
          antrian.iPotongan += 1;
          setSisaMs(perkiraanSisaWaktuImpor(waktuRef.current.terpakaiMs, waktuRef.current.berkas, antrian.berkasTotal));
        }
        antrian.iFolder += 1;
        antrian.iPotongan = 0;
        antrian.potongan = null;
        tulisTitikSimpan(penyimpanLokal(), antrian.ruang, [
          ...antrian.selesaiAwal,
          ...antrian.folders.slice(0, antrian.iFolder).map((item) => item.id),
        ]);
        setFolderSelesai(antrian.selesaiAwal.length + antrian.iFolder);
      }
      penguraiRef.current?.tutup();
      penguraiRef.current = null;
      hapusTitikSimpan(penyimpanLokal(), antrian.ruang);
      setStatus("selesai");
      setSisaMs(null);
      setPesan("Semua folder selesai diproses. Riwayat yang sudah masuk tidak akan digandakan bila diimpor lagi.");
    } catch (cause) {
      setStatus("gagal");
      setError(cause instanceof Error ? cause.message : "Impor berhenti. Data yang sudah masuk aman dan tidak akan digandakan.");
    } finally {
      berjalanRef.current = false;
    }
  }, [berkasTerpilih, prosesPotongan]);

  const tombolAliran = () => {
    if (membacaFolder) return;
    if (status === "berjalan") {
      jedaRef.current = true;
      return;
    }
    if (!setuju) return setError("Centang persetujuan impor sebelum memulai.");
    if (!berkasTerpilih.length) return setError("Pilih folder rekam medis terlebih dulu.");
    void jalankan();
  };

  const simpanKeputusan = () => {
    if (!pertanyaanTerjawab) return setError("Tentukan keputusan untuk setiap data yang mirip lebih dulu.");
    setError("");
    setMenyimpanKeputusan(true);
    void (async () => {
      try {
        const payload = keputusanKePayload(keputusan);
        const rows = pertanyaan.flatMap((item) => {
          const row = tertundaRef.current.get(item.source_key);
          return row ? [row] : [];
        });
        const kirimanSemua = bagiKirimanBaris(rows);
        let tersimpan = 0;
        let sudahAda = 0;
        let dilewati = 0;
        for (let index = 0; index < kirimanSemua.length; index += 1) {
          const kiriman = kirimanSemua[index];
          const kunci = new Set(kiriman.map((row) => row.source_key));
          const jawaban = await kirimDenganUlangan<HasilPotonganImporRekamMedis>(async () => {
            const hasil = await prosesPotonganImporRekamMedis(kiriman, payload.filter((item) => kunci.has(item.source_key)), true, index === kirimanSemua.length - 1);
            if (!hasil.ok) throw new Error(hasil.message);
            return hasil;
          });
          tersimpan += jawaban.tersimpan;
          sudahAda += jawaban.sudah_ada;
          dilewati += jawaban.dilewati;
          if (jawaban.ditahan.length) catatDitahan(jawaban.ditahan);
        }
        for (const row of rows) tertundaRef.current.delete(row.source_key);
        setPertanyaan([]);
        setKeputusan({});
        setHitungan((current) => ({
          ...current,
          tersimpan: current.tersimpan + tersimpan,
          sudahAda: current.sudahAda + sudahAda,
          dilewati: current.dilewati + dilewati,
          perluKeputusan: Math.max(0, current.perluKeputusan - rows.length),
        }));
        setPesan(`${tersimpan} riwayat dari pertanyaan identitas berhasil disimpan.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Keputusan identitas gagal disimpan.");
      } finally {
        setMenyimpanKeputusan(false);
      }
    })();
  };

  const unduhCatatan = () => {
    if (typeof window === "undefined" || !ditahanRef.current.length) return;
    const blob = new Blob([csvRiwayatDitahan(ditahanRef.current)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const tautan = document.createElement("a");
    tautan.href = url;
    tautan.download = namaBerkasCatatanDitahan(new Date());
    tautan.click();
    URL.revokeObjectURL(url);
  };

  const berjalan = status === "berjalan";
  const terkunci = berjalan || membacaFolder;
  const persen = folderTotal ? Math.min(100, Math.max(2, Math.round((folderSelesai / folderTotal) * 100))) : 0;

  return (
    <div className="crm-sec">
      <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
        <i className="ti ti-shield-check" /> Pilih satu folder induk, atau pilih banyak folder di Windows Explorer dengan Shift/Ctrl lalu seret sekaligus ke kotak biru di bawah. Sistem membaca owner dari folder, nama hewan dari kartu, dan setiap sheet sebagai satu histori bersama untuk semua cabang klinik.
      </div>
      <div className="p2ban" style={{ marginTop: 8, background: "#f8fafc", border: ".5px solid #cbd5e1", color: "#475569" }}>
        <i className="ti ti-info-circle" /> Folder diproses sepotong demi sepotong dan langsung disimpan, jadi folder besar tidak perlu ditahan di memori. Bisa dijeda, dan bila terputus tinggal pilih folder yang sama lagi — bagian yang sudah masuk dilewati. Batas 5 MB per file kartu.
      </div>
      <FolderDropZone disabled={berjalan || menyimpanKeputusan}
        onBusy={setMembacaFolder} onError={setError}
        onChoose={(files) => pilihBerkas(gabungBerkasPilihan(berkasTerpilih, files))} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-folder" /> Pilih folder rekam medis
          <input type="file" multiple ref={(input) => { if (input) input.webkitdirectory = true; }} style={{ display: "none" }} disabled={terkunci} onChange={(event) => {
            pilihBerkas(Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith(".xlsx") && !file.name.startsWith("~$")));
            event.target.value = "";
          }} />
        </label>
        {berkasTerpilih.length > 0 && <label className="btn-def" style={{ cursor: berjalan ? "not-allowed" : "pointer" }}>
          <i className="ti ti-folder-plus" /> Tambah folder lain
          <input type="file" multiple ref={(input) => { if (input) input.webkitdirectory = true; }} style={{ display: "none" }} disabled={terkunci} onChange={(event) => {
            const baru = Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith(".xlsx") && !file.name.startsWith("~$"));
            event.target.value = "";
            if (baru.length) pilihBerkas(gabungBerkasPilihan(berkasTerpilih, baru));
          }} />
        </label>}
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-files" /> Pilih file satuan
          <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} disabled={terkunci} onChange={(event) => {
            pilihBerkas(Array.from(event.target.files ?? []));
          }} />
        </label>
        <button type="button" className="btn-acc" disabled={membacaFolder || !berkasTerpilih.length || (!setuju && status !== "berjalan") || menyimpanKeputusan} onClick={tombolAliran} style={{ background: berjalan ? "#b45309" : "#15803d" }}>
          {berjalan ? <i className="ti ti-player-pause" /> : <i className="ti ti-database-import" />} {labelTombolAliran(status)}
        </button>
        {ditahan.length > 0 && <button type="button" className="btn-def" onClick={unduhCatatan}><i className="ti ti-download" /> Unduh catatan ditahan ({ditahan.length})</button>}
      </div>
      {berkasTerpilih.length > 0 && (() => {
        const utama = daftarFolderUtama(berkasTerpilih);
        return <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>
          {berkasTerpilih.length.toLocaleString("id-ID")} file dipilih{utama.length > 1 ? ` dari ${utama.length} folder` : ""}.
          {utama.length > 1 && <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{utama.map((nama) => <li key={nama}>{nama}</li>)}</ul>}
          {!terkunci && <button type="button" className="btn-def" style={{ fontSize: 10, marginLeft: 8 }} onClick={() => pilihBerkas([])}>Kosongkan pilihan</button>}
        </div>;
      })()}

      <label style={{ fontSize: 11, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
        <input type="checkbox" checked={setuju} disabled={terkunci} onChange={(event) => setSetuju(event.target.checked)} />
        Saya setuju menyimpan riwayat yang aman sambil berjalan. Riwayat yang ditahan dan yang perlu keputusan tidak ikut disimpan otomatis.
      </label>

      {status !== "siap" && (
        <div role="status" style={{ marginTop: 12, padding: "10px 12px", border: ".5px solid #bfdbfe", borderRadius: 8, background: "#eff6ff", color: "#1e40af" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 800 }}>
            {berjalan && <span className="btn-spin" />} {progres}
          </div>
          <div role="progressbar" aria-label="Kemajuan impor rekam medis" aria-valuemin={0} aria-valuemax={folderTotal || 1} aria-valuenow={folderSelesai} style={{ width: "100%", height: 8, marginTop: 8, borderRadius: 999, background: "#dbeafe", overflow: "hidden" }}>
            <div style={{ width: `${persen}%`, height: "100%", background: "#2563eb", borderRadius: 999, transition: "width .2s ease" }} />
          </div>
          {berjalan && <div style={{ fontSize: 10.5, marginTop: 5 }}>Boleh dijeda kapan saja. Bila halaman tertutup, riwayat yang sudah masuk tetap aman.</div>}
        </div>
      )}

      {error && <div className="p2ban" style={{ marginTop: 12, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {pesan && <div className="p2ban" style={{ marginTop: 12, background: "#ecfdf5", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-check" /> {pesan}</div>}

      {pertanyaan.length > 0 && (
        <div style={{ marginTop: 12, padding: 11, borderRadius: 8, background: "#fffbeb", border: ".5px solid #fcd34d", color: "#854d0e" }}>
          <div style={{ fontSize: 11.5, fontWeight: 900 }}><i className="ti ti-git-compare" /> {pertanyaan.length} data mirip perlu keputusan</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>Impor tetap jalan tanpa menunggu jawaban. Sistem tidak akan menggabungkan pemilik atau anabul hanya karena namanya mirip atau nomor teleponnya sama.</div>
          <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
            {pertanyaan.slice(0, MAKS_BARIS_TAMPIL).map((item) => (
              <div key={item.source_key} style={{ padding: 9, borderRadius: 7, background: "white", border: ".5px solid #fde68a" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800 }}>Dari file: {item.owner_name} · {item.phone} · anabul {item.patient_name}</div>
                <select
                  value={keputusan[item.source_key] ?? ""}
                  onChange={(event) => setKeputusan((current) => ({ ...current, [item.source_key]: event.target.value }))}
                  style={{ marginTop: 7, width: "100%", maxWidth: 560, padding: "7px 8px", borderRadius: 6, border: ".5px solid #d6d3d1", background: "white", fontSize: 10.5 }}
                >
                  <option value="">Pilih keputusan…</option>
                  {item.candidates.map((candidate) => (
                    <option key={`${candidate.customer_id}-${candidate.pet_id ?? "baru"}`} value={JSON.stringify({ customer_id: candidate.customer_id, pet_id: candidate.pet_id })}>
                      Ini sama: {candidate.customer_name} · {candidate.customer_phone || "tanpa nomor"} · {candidate.pet_name ? `anabul ${candidate.pet_name}` : "buat anabul baru"}
                      {item.candidates.some((other) => other !== candidate && kunciPilihan(other.customer_name) === kunciPilihan(candidate.customer_name) && kunciPilihan(other.customer_phone) === kunciPilihan(candidate.customer_phone) && kunciPilihan(other.pet_name) === kunciPilihan(candidate.pet_name)) && ` · referensi ${candidate.pet_id ?? candidate.customer_id}`}
                    </option>
                  ))}
                  <option value="skip">Beda — jangan impor riwayat ini</option>
                </select>
              </div>
            ))}
          </div>
          {pertanyaan.length > MAKS_BARIS_TAMPIL && <div style={{ fontSize: 10.5, marginTop: 6 }}>Menampilkan {MAKS_BARIS_TAMPIL} pertanyaan pertama. Jawab dan simpan dulu, sisanya menyusul.</div>}
          <button type="button" className="btn-acc" disabled={menyimpanKeputusan || !pertanyaanTerjawab} onClick={simpanKeputusan} style={{ marginTop: 10, background: "#15803d" }}>
            {menyimpanKeputusan ? <span className="btn-spin" /> : <i className="ti ti-check" />} Simpan keputusan identitas
          </button>
        </div>
      )}

      {ditahan.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "#b91c1c" }}>Riwayat ditahan ({ditahan.length})</div>
          <div style={{ marginTop: 6, maxHeight: 320, overflow: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
            <table className="dt" style={{ width: "100%", minWidth: 620 }}>
              <thead><tr><th>File</th><th>Sheet</th><th>Alasan</th></tr></thead>
              <tbody>
                {ditahan.slice(-MAKS_BARIS_TAMPIL).map((row, index) => (
                  <tr key={`${row.source_key}-${index}`}><td>{row.source_file}</td><td>{row.source_sheet}</td><td style={{ color: "#b91c1c" }}>{row.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {ditahan.length > MAKS_BARIS_TAMPIL && <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Menampilkan {MAKS_BARIS_TAMPIL} terakhir. Unduh catatan untuk daftar lengkap beserta alasannya.</div>}
        </div>
      )}
    </div>
  );
}
