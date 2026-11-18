"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ubahDokterPJ } from "@/app/(app)/klinik/ubah-dokter-pj-actions";
import {
  ALASAN_UBAH_DOKTER_MAX, ALASAN_UBAH_DOKTER_MIN, alasanUbahDokter, isPenolakanUbahDokter,
  PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI, type HasilUbahDokter, type PilihanDokterUbah,
} from "@/lib/ubah-dokter-pj";

const TAP = 44; // target sentuh nyaman untuk tablet/ponsel kasir

/**
 * Tombol + dialog "Ubah dokter" untuk kunjungan (rawat inap dan rawat jalan).
 * Layar bukan otorisasi: database memeriksa ulang peran, cabang, alasan, dokter, tagihan lunas dan payroll.
 * Kotak konfirmasi Owner muncul hanya bila database memintanya (hanya dijawab begitu untuk Owner).
 * Hasil (berhasil atau ditolak) selalu tampil sebagai kalimat; tidak pernah galat umum.
 */
export function UbahDokterPJ({ visitId, dokterSekarang, dokter, label = "Ubah dokter" }: {
  visitId: string;
  dokterSekarang: string | null;
  dokter: readonly PilihanDokterUbah[];
  label?: string;
}) {
  const router = useRouter();
  const [terbuka, setTerbuka] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [alasan, setAlasan] = useState("");
  const [ikutBaris, setIkutBaris] = useState(true);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [hasil, setHasil] = useState<HasilUbahDokter | null>(null);
  const [pending, mulai] = useTransition();
  // Satu kunci per pembukaan dialog: tekan Simpan dua kali / ulang setelah jaringan putus = permintaan yang sama.
  const kunci = useRef("");
  const tombolBuka = useRef<HTMLButtonElement>(null);

  const buka = () => {
    kunci.current = crypto.randomUUID();
    setDoctorId(""); setAlasan(""); setIkutBaris(true); setKonfirmasi(false); setHasil(null); setTerbuka(true);
  };
  const tutup = () => { setTerbuka(false); tombolBuka.current?.focus(); };
  useEffect(() => {
    if (!terbuka) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending) tutup(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [terbuka, pending]);

  const berhasil = hasil?.ok === true;
  const alasanSah = alasanUbahDokter(alasan);
  const perluKonfirmasi = isPenolakanUbahDokter(hasil) && hasil.perluKonfirmasi === true;
  const siapKirim = !!doctorId && !!alasanSah && !pending && !berhasil && !(perluKonfirmasi && !konfirmasi);

  const kirim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!siapKirim) return;
    setHasil(null);
    mulai(async () => {
      let res: HasilUbahDokter;
      try {
        res = await ubahDokterPJ({ visitId, doctorId, reason: alasan, requestKey: kunci.current, ikutBaris, konfirmasiFinal: konfirmasi });
      } catch {
        res = { ok: false, kode: "TIDAK_TERKONFIRMASI", pesan: PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI };
      }
      setHasil(res);
      if (res.ok) router.refresh();
    });
  };

  if (dokter.length === 0) return null;
  return (
    <>
      <button ref={tombolBuka} type="button" className="btn-def" data-testid="ubah-dokter-buka" onClick={buka}
        style={{ minHeight: TAP, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
        <i className="ti ti-user-edit" aria-hidden="true" /> {label}
      </button>
      {terbuka && (
        <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <form role="dialog" aria-modal="true" aria-labelledby="ubah-dokter-judul" onSubmit={kirim} data-testid="ubah-dokter-form"
            style={{ background: "#fff", borderRadius: 12, padding: 16, width: "min(520px, 100%)", maxHeight: "calc(100vh - 24px)", overflowY: "auto", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
            <h2 id="ubah-dokter-judul" style={{ fontSize: 17, margin: "0 0 4px" }}>Ubah dokter PJ</h2>
            <p style={{ fontSize: 12.5, color: "var(--tm)", margin: "0 0 12px" }}>
              Dokter sekarang: <b>{dokterSekarang ?? "belum tercatat"}</b>. Pakai ini hanya bila dokter PJ salah dimasukkan. Catatan visit dokter yang sudah ditulis tidak berubah.
            </p>
            <label className="flab" htmlFor="ubah-dokter-pilih">Dokter PJ yang benar *</label>
            <select id="ubah-dokter-pilih" className="fi" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} disabled={pending || berhasil}
              style={{ minHeight: TAP, fontSize: 15 }} required>
              <option value="">— Pilih dokter —</option>
              {dokter.map((d) => <option key={d.id} value={d.id}>{d.nama}</option>)}
            </select>
            <label className="flab" htmlFor="ubah-dokter-alasan" style={{ marginTop: 10, display: "block" }}>Alasan * <span style={{ fontWeight: 400, color: "var(--tm)" }}>({ALASAN_UBAH_DOKTER_MIN}–{ALASAN_UBAH_DOKTER_MAX} huruf)</span></label>
            <textarea id="ubah-dokter-alasan" className="fi" rows={3} value={alasan} maxLength={ALASAN_UBAH_DOKTER_MAX} onChange={(e) => setAlasan(e.target.value)}
              disabled={pending || berhasil} placeholder="Contoh: dokter PJ dan pemberi obat sebenarnya dr. Aini" style={{ fontSize: 15 }} required />
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "12px 0", minHeight: TAP, fontSize: 13.5 }}>
              <input type="checkbox" checked={ikutBaris} onChange={(e) => setIkutBaris(e.target.checked)} disabled={pending || berhasil}
                style={{ width: 24, height: 24, marginTop: 2, flexShrink: 0 }} data-testid="ubah-dokter-ikut" />
              <span>Ikut ubah pelaksana baris resep/tindakan yang <b>belum ditagih</b> dan masih dokter lama. Baris yang sudah ditagih, racikan, atau berpelaksana dokter lain tidak diubah.</span>
            </label>
            {perluKonfirmasi && (
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "0 0 12px", minHeight: TAP, fontSize: 13.5, background: "#fffbeb", border: ".5px solid #fcd34d", borderRadius: 8, padding: 8 }}>
                <input type="checkbox" checked={konfirmasi} onChange={(e) => setKonfirmasi(e.target.checked)} disabled={pending}
                  style={{ width: 24, height: 24, marginTop: 2, flexShrink: 0 }} data-testid="ubah-dokter-konfirmasi" />
                <span>Saya Owner dan paham: tagihan lunas yang mengikuti dokter kunjungan akan memindahkan komisi bulan pelunasannya ke dokter baru.</span>
              </label>
            )}
            {hasil && (
              <div role={hasil.ok ? "status" : "alert"} data-testid="ubah-dokter-hasil"
                style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, margin: "0 0 12px", border: ".5px solid", ...(hasil.ok ? { background: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" } : { background: "#fef2f2", color: "#b91c1c", borderColor: "#fca5a5" }) }}>
                {hasil.pesan}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="btn-def" onClick={tutup} disabled={pending} style={{ minHeight: TAP, padding: "0 16px" }}>{berhasil ? "Tutup" : "Batal"}</button>
              {!berhasil && (
                <button type="submit" className="btn-p" disabled={!siapKirim} aria-busy={pending || undefined} data-testid="ubah-dokter-simpan"
                  style={{ minHeight: TAP, padding: "0 18px", background: "var(--posb, #2563eb)", color: "#fff", border: 0, borderRadius: 8, fontWeight: 700, fontSize: 14, opacity: siapKirim ? 1 : 0.6 }}>
                  {pending ? "Menyimpan…" : perluKonfirmasi && !konfirmasi ? "Simpan (centang konfirmasi)" : "Simpan"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
