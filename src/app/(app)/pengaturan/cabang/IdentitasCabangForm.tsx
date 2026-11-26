"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RekamMedisKop } from "@/components/RekamMedisKop";
import {
  ALAMAT_MAX, LOGO_ACCEPT, LOGO_BUCKET, TELEPON_MAX, jalurLogoBaru, rapikanTeks, validasiAlamat, validasiBerkasLogo, validasiTelepon,
} from "@/lib/cabang-identitas";
import { simpanIdentitasCabang, type IdentitasCabangState } from "./actions";

type Props = {
  branch: { id: string; code: string; name: string; alamat: string | null; telepon: string | null; logoUrl: string | null };
  bolehKelola: boolean;
};

/** Satu form per cabang klinik: alamat, telepon, logo (unggah ≤ 1 MB, pratinjau, hapus). Nama cabang diubah di Perusahaan > Cabang. */
export function IdentitasCabangForm({ branch, bolehKelola }: Props) {
  const [alamat, setAlamat] = useState(branch.alamat ?? "");
  const [telepon, setTelepon] = useState(branch.telepon ?? "");
  const [aksi, setAksi] = useState<"tetap" | "ganti" | "hapus">("tetap");
  const [logoBaru, setLogoBaru] = useState<string | null>(null);   // jalur storage unggahan baru (belum disimpan)
  const [pratinjau, setPratinjau] = useState<string | null>(null);  // URL lokal berkas yang dipilih
  const [galatLogo, setGalatLogo] = useState("");
  const [mengunggah, setMengunggah] = useState(false);
  const inputFile = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<IdentitasCabangState, FormData>(async (prev, fd) => {
    const hasil = await simpanIdentitasCabang(prev, fd);
    // Simpan berhasil: server memuat ulang data cabang; kembali ke keadaan "tetap" dengan logo yang tersimpan.
    if (hasil?.ok) { setAksi("tetap"); setLogoBaru(null); setPratinjau(null); if (inputFile.current) inputFile.current.value = ""; }
    return hasil;
  }, null);

  const salahAlamat = validasiAlamat(rapikanTeks(alamat));
  const salahTelepon = validasiTelepon(rapikanTeks(telepon));
  const logoTampil = aksi === "hapus" ? null : aksi === "ganti" ? pratinjau : branch.logoUrl;

  async function bersihkanUnggahan(path: string | null) {
    if (!path) return;
    try { await createClient().storage.from(LOGO_BUCKET).remove([path]); } catch { /* yatim kecil, tidak menghalangi */ }
  }

  async function pilihBerkas(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setGalatLogo("");
    const salah = validasiBerkasLogo(f);
    if (salah) { setGalatLogo(salah); e.target.value = ""; return; }
    const path = jalurLogoBaru(branch.id, f.type, Date.now(), Math.random().toString(36).slice(2));
    if (!path) { setGalatLogo("Logo tidak dapat diunggah untuk cabang ini."); return; }
    setMengunggah(true);
    try {
      const { error } = await createClient().storage.from(LOGO_BUCKET).upload(path, f, { upsert: false, contentType: f.type, cacheControl: "3600" });
      if (error) { setGalatLogo("Logo gagal diunggah. Pastikan kamu Owner/Admin lalu coba lagi."); e.target.value = ""; return; }
      await bersihkanUnggahan(logoBaru);   // unggahan sebelumnya yang belum disimpan
      setLogoBaru(path); setAksi("ganti");
      setPratinjau((lama) => { if (lama) URL.revokeObjectURL(lama); return URL.createObjectURL(f); });
    } catch {
      setGalatLogo("Logo gagal diunggah. Coba lagi."); e.target.value = "";
    } finally { setMengunggah(false); }
  }

  async function batalGanti() {
    await bersihkanUnggahan(logoBaru);
    setLogoBaru(null); setAksi("tetap"); setPratinjau(null); setGalatLogo("");
    if (inputFile.current) inputFile.current.value = "";
  }

  return (
    <form action={formAction} aria-label={`Identitas dokumen ${branch.name}`}
      style={{ display: "grid", gap: 8, padding: "10px 0", borderBottom: ".5px solid var(--bd)" }}>
      <input type="hidden" name="id" value={branch.id} />
      <input type="hidden" name="logo_aksi" value={aksi} />
      <input type="hidden" name="logo_path" value={aksi === "ganti" ? (logoBaru ?? "") : ""} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>{branch.name}</strong>
        <span style={{ fontSize: 9.5, color: "var(--td)", fontFamily: "monospace" }}>{branch.code}</span>
        {bolehKelola && <Link href="/perusahaan/cabang" style={{ fontSize: 10, color: "var(--acc)" }}>Ubah nama cabang di Perusahaan › Cabang</Link>}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <label className="flab" htmlFor={`alamat-${branch.id}`}>Alamat (tercetak di kop)</label>
          <input id={`alamat-${branch.id}`} className="fi" name="alamat" value={alamat} maxLength={ALAMAT_MAX} disabled={!bolehKelola}
            onChange={(e) => setAlamat(e.target.value)} placeholder="Jl. contoh no. 1, Kota" />
          {salahAlamat && <div role="alert" style={{ color: "#b91c1c", fontSize: 10.5 }}>{salahAlamat}</div>}
          <label className="flab" htmlFor={`telp-${branch.id}`} style={{ marginTop: 6, display: "block" }}>Telepon (tercetak di kop)</label>
          <input id={`telp-${branch.id}`} className="fi" name="telepon" value={telepon} maxLength={TELEPON_MAX} disabled={!bolehKelola}
            onChange={(e) => setTelepon(e.target.value)} placeholder="0251 1234567" style={{ maxWidth: 220 }} />
          {salahTelepon && <div role="alert" style={{ color: "#b91c1c", fontSize: 10.5 }}>{salahTelepon}</div>}
          <div style={{ marginTop: 8 }}>
            <span className="flab">Logo (PNG, JPG, atau WEBP, maks. 1 MB)</span>
            {bolehKelola && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
                <label className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, cursor: mengunggah ? "wait" : "pointer", padding: "4px 10px" }}>
                  <i className="ti ti-upload" /> {mengunggah ? "Mengunggah…" : "Pilih logo"}
                  <input ref={inputFile} type="file" hidden accept={LOGO_ACCEPT} disabled={mengunggah || pending} onChange={pilihBerkas} aria-label={`Logo ${branch.name}`} />
                </label>
                {aksi === "ganti" && <button type="button" className="btn-def" style={{ fontSize: 10.5, padding: "4px 10px" }} onClick={batalGanti}>Batal ganti</button>}
                {aksi === "tetap" && branch.logoUrl && (
                  <button type="button" className="btn-def" style={{ fontSize: 10.5, padding: "4px 10px" }} onClick={() => setAksi("hapus")}>Hapus logo</button>
                )}
                {aksi === "hapus" && <button type="button" className="btn-def" style={{ fontSize: 10.5, padding: "4px 10px" }} onClick={() => setAksi("tetap")}>Batal hapus</button>}
              </div>
            )}
            {galatLogo && <div role="alert" style={{ color: "#b91c1c", fontSize: 10.5, marginTop: 2 }}>{galatLogo}</div>}
          </div>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 260 }}>
          <span className="flab">Pratinjau kop rekam medis</span>
          <div style={{ border: ".5px dashed var(--bd)", borderRadius: 8, padding: 10, borderBottom: "2px solid var(--posb)" }} data-pratinjau-kop>
            <RekamMedisKop nama={branch.name} alamat={rapikanTeks(alamat)} telepon={rapikanTeks(telepon)} logoUrl={logoTampil} />
          </div>
        </div>
      </div>
      {bolehKelola && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn-acc" disabled={pending || mengunggah || !!salahAlamat || !!salahTelepon}>{pending ? "Menyimpan…" : "Simpan identitas"}</button>
          {state && <span role={state.ok ? "status" : "alert"} style={{ fontSize: 11, color: state.ok ? "#15803d" : "#b91c1c" }}>{state.message}</span>}
        </div>
      )}
    </form>
  );
}
