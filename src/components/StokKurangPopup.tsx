"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  angkaTampil, kekurangan, uraiKekuranganStok, type BarisKurangStok,
} from "@/lib/stok-kurang";

/**
 * SATU popup "Stok tidak cukup" untuk semua proses yang mengeluarkan stok.
 *
 * Dipakai dua arah:
 *   - pemeriksaan di layar sebelum tombol simpan diteruskan (`baris` dari hitungan sendiri);
 *   - penolakan server/database yang sampai sebagai kalimat (`StokKurangDariPesan`).
 *
 * Memakai <dialog>.showModal() seperti komponen `Popup` yang sudah ada: dari situ
 * jebakan fokus, Esc, dan inert-nya halaman di belakang datang gratis dari peramban.
 * Atribut role/aria-modal tetap ditulis supaya pembaca layar lama tidak menebak.
 */

const TEKS_TOMBOL = "Ubah jumlah";

function Angka({ nilai, satuan }: { nilai: number | null; satuan?: string | null }) {
  if (nilai == null) return <span style={{ color: "var(--td)" }}>—</span>;
  return <>{angkaTampil(nilai)}{satuan ? <span style={{ color: "var(--tm)" }}> {satuan}</span> : null}</>;
}

export function StokKurangPopup({ baris, petunjuk, gudang, onClose }: {
  baris: BarisKurangStok[];
  petunjuk?: string | null;
  /** Nama gudang untuk baris yang tidak membawa gudangnya sendiri. */
  gudang?: string | null;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const terbuka = baris.length > 0;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !terbuka || dialog.open) return;
    // showModal belum ada di sebagian lingkungan (mis. jsdom saat diuji); atribut
    // open menjaga isinya tetap terbaca walau tanpa jebakan fokus bawaan.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.open = true;
  }, [terbuka]);

  if (!terbuka) return null;

  const rows = baris.map((b) => ({ ...b, gudang: b.gudang ?? gudang ?? null }));
  const adaGudang = rows.some((b) => b.gudang);
  const adaAngka = rows.some((b) => b.butuh != null || b.tersedia != null);

  const tutup = () => {
    const dialog = ref.current;
    if (dialog?.open) { if (typeof dialog.close === "function") dialog.close(); else dialog.open = false; }
    fokuskanBarisKurang(rows[0]);
    onClose?.();
  };

  return <dialog
    ref={ref}
    role="dialog"
    aria-modal="true"
    aria-labelledby="stok-kurang-judul"
    aria-describedby="stok-kurang-rincian"
    onCancel={(e) => { e.preventDefault(); tutup(); }}
    // Esc sudah ditangani peramban lewat onCancel; penangan ini hanya untuk
    // lingkungan tanpa showModal, supaya dialognya tetap bisa ditutup dari papan ketik.
    onKeyDown={(e) => {
      if (e.key !== "Escape" || typeof ref.current?.showModal === "function") return;
      e.preventDefault();
      tutup();
    }}
    style={{
      margin: "auto", border: ".5px solid #fca5a5", borderRadius: 12, padding: 0,
      maxWidth: 560, width: "calc(100% - 24px)", maxHeight: "calc(100dvh - 32px)", overflow: "auto",
      background: "var(--sf, #fff)", color: "var(--sb)",
    }}
  >
    <div style={{ padding: "16px 16px 14px" }}>
      <div id="stok-kurang-judul" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: "#b91c1c", fontSize: 14, marginBottom: 4 }}>
        <i className="ti ti-alert-circle" style={{ fontSize: 20 }} aria-hidden="true" /> Stok tidak cukup
      </div>
      <div style={{ fontSize: 11.5, color: "var(--tm)", marginBottom: 10 }}>
        {rows.length === 1
          ? "Satu barang jumlahnya melebihi stok yang ada."
          : `${rows.length} barang jumlahnya melebihi stok yang ada.`}
      </div>

      {/* Penolakan database kadang hanya menyebut barangnya tanpa angka. Tabel
          berisi tanda hubung semua tidak menolong siapa pun, jadi jadikan kalimat. */}
      {!adaAngka ? (
        <div id="stok-kurang-rincian" style={{ fontSize: 11.5, border: ".5px solid var(--bd)", borderRadius: 8, padding: "8px 10px" }}>
          {rows.map((b) => b.nama).join(", ")}
          {adaGudang ? ` — ${rows.map((b) => b.gudang).find(Boolean)}` : ""}
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 2 }}>
            Jumlah yang diminta melebihi stok. Rincian angkanya tidak disertakan oleh sistem.
          </div>
        </div>
      ) : (
      <div id="stok-kurang-rincian" style={{ overflowX: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
        <table className="tbl" style={{ minWidth: adaGudang ? 440 : 340, margin: 0 }}>
          <thead>
            <tr>
              <th>Barang</th>
              {adaGudang && <th>Gudang</th>}
              <th style={{ textAlign: "right" }}>Dibutuhkan</th>
              <th style={{ textAlign: "right" }}>Tersedia</th>
              <th style={{ textAlign: "right" }}>Kurang</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={`${b.item_id ?? b.kunci ?? b.nama}-${i}`}>
                <td style={{ fontSize: 11.5, fontWeight: 500 }}>{b.nama}</td>
                {adaGudang && <td style={{ fontSize: 11, color: "var(--tm)" }}>{b.gudang ?? "—"}</td>}
                <td style={{ textAlign: "right", fontSize: 11.5 }}><Angka nilai={b.butuh} satuan={b.satuan} /></td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}><Angka nilai={b.tersedia} satuan={b.satuan} /></td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>
                  <Angka nilai={kekurangan(b)} satuan={b.satuan} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 10 }}>
        {petunjuk ?? "Kurangi jumlahnya sampai tidak melebihi stok yang tersedia."}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" className="btn-acc" autoFocus onClick={tutup}>
          <i className="ti ti-pencil" aria-hidden="true" /> {TEKS_TOMBOL}
        </button>
      </div>
    </div>
  </dialog>;
}

/**
 * Mengantar petugas ke isian yang harus diubah. Layar menandai isiannya dengan
 * `data-stok-kurang="<kunci baris, item_id, atau nama barang>"`. Nama ikut dicoba
 * karena penolakan yang datang sebagai kalimat hanya menyebut nama barangnya.
 * Kalau tidak ada yang cocok, fokus jatuh ke penanda pertama.
 */
function fokuskanBarisKurang(baris: BarisKurangStok | undefined) {
  if (typeof document === "undefined") return;
  const cocok = [baris?.kunci, baris?.item_id, baris?.nama]
    .filter((v): v is string => typeof v === "string" && v !== "")
    .map((v) => document.querySelector<HTMLElement>(`[data-stok-kurang="${v.replace(/["\\]/g, "\\$&")}"]`))
    .find((el): el is HTMLElement => el !== null);
  const target = cocok ?? document.querySelector<HTMLElement>("[data-stok-kurang]");
  if (!target) return;
  const isian = target.matches("input, select, textarea, button, [tabindex]")
    ? target
    : target.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]") ?? target;
  isian.scrollIntoView?.({ block: "center" });
  isian.focus?.();
  if (isian instanceof HTMLInputElement) isian.select?.();
}

/**
 * Jembatan untuk layar yang hanya menerima KALIMAT penolakan (dari `?error=`).
 * Bukan soal stok → tidak menampilkan apa-apa, dan bilah merah halaman tetap jadi
 * satu-satunya pesan.
 */
export function StokKurangDariPesan({ pesan, gudang, petunjuk }: {
  pesan?: string | null;
  gudang?: string | null;
  petunjuk?: string | null;
}) {
  const hasil = useMemo(() => uraiKekuranganStok(pesan), [pesan]);
  // Yang diingat adalah PESAN yang sudah ditutup, bukan sekadar "sudah ditutup".
  // Dengan begitu penolakan berikutnya tetap memunculkan popup lagi tanpa perlu
  // efek yang me-reset keadaan setiap pesannya berganti.
  const [ditutup, setDitutup] = useState<string | null>(null);
  if (!hasil || ditutup === (pesan ?? "")) return null;
  return <StokKurangPopup
    baris={hasil.baris}
    petunjuk={petunjuk ?? hasil.petunjuk}
    gudang={gudang}
    onClose={() => setDitutup(pesan ?? "")}
  />;
}
