"use client";

// Impor bagan akun dua langkah: Periksa (pratinjau lengkap, tanpa menulis apa pun) → Simpan
// (server membuat ulang pratinjau dari isi yang sama lalu menyimpan semuanya atau tidak sama sekali).

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import type { KonfigImpor } from "@/lib/impor-jenis";
import type { StatusBaris } from "@/lib/impor-akun";
import { PEMETAAN_AKUN } from "@/lib/impor-akun-pemetaan";
import { prosesImporAkun, type HasilImporAkun } from "../actions";

const AWAL: HasilImporAkun = { langkah: "awal", pesan: null, rencana: null, sha: null, versi: null };

const LABEL: Record<StatusBaris, { teks: string; warna: string; latar: string }> = {
  baru: { teks: "Baru", warna: "#15803d", latar: "#f0fdf4" },
  sama: { teks: "Sudah ada (sama)", warna: "#475569", latar: "#f8fafc" },
  berubah: { teks: "Berubah", warna: "#b45309", latar: "#fffbeb" },
  konflik: { teks: "Konflik", warna: "#7c3aed", latar: "#f5f3ff" },
  ditolak: { teks: "Ditolak", warna: "#b91c1c", latar: "#fef2f2" },
};
const URUT: StatusBaris[] = ["ditolak", "konflik", "berubah", "baru", "sama"];

export function ImporAkunForm({ konfig }: { konfig: KonfigImpor }) {
  const [state, proses] = useActionState(prosesImporAkun, AWAL);
  const [csv, setCsv] = useState("");
  const [namaFile, setNamaFile] = useState("");
  const [diperiksa, setDiperiksa] = useState<string | null>(null);
  const wajib = new Set<string>(konfig.wajib);
  const r = state.rencana;
  const masihSama = diperiksa !== null && diperiksa === csv;

  const ambilFile = async (f: File | undefined) => {
    if (!f) return;
    setNamaFile(f.name);
    setCsv(await f.text());
  };

  const unduhContoh = () => {
    const blob = new Blob(["﻿" + konfig.contoh], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = konfig.namaFile;
    a.click();
    URL.revokeObjectURL(url);
  };

  const baris = r ? [...r.baris].sort((a, b) => URUT.indexOf(a.status) - URUT.indexOf(b.status) || a.no - b.no) : [];

  return (
    <form action={proses} className="crm-sec" onSubmit={() => setDiperiksa(csv)}>
      <input type="hidden" name="csv" value={csv} />
      <input type="hidden" name="sha" value={state.sha ?? ""} />
      <input type="hidden" name="versi" value={state.versi ?? ""} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <label className="flab" htmlFor="sumber-akun" style={{ margin: 0 }}>Format file</label>
        <select id="sumber-akun" name="sumber" className="fi" style={{ width: "auto" }} defaultValue="kamo">
          {Object.entries(PEMETAAN_AKUN).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
        </select>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-file-upload" /> Pilih file CSV
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => ambilFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="btn-def" onClick={unduhContoh}>
          <i className="ti ti-download" /> Unduh contoh
        </button>
        {namaFile && <span style={{ fontSize: 11, color: "var(--tm)" }}><i className="ti ti-paperclip" /> {namaFile}</span>}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--td)", marginBottom: 10 }}>
        Ekspor Accurate belum bisa dibaca langsung — pemetaan kolomnya menunggu contoh file asli. Untuk sekarang
        salin isinya ke format contoh KAMO (unduh contoh di atas).
      </div>

      <label className="flab">Isi file (boleh ditempel langsung dari Excel)</label>
      <textarea className="fi" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={konfig.contoh}
        style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.6, resize: "vertical" }} />

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 6, lineHeight: 1.7 }}>
        Kolom yang dikenali: {konfig.kolom.map((k) => (
          <code key={k} style={{ marginRight: 6, fontWeight: wajib.has(k) ? 700 : 400, color: wajib.has(k) ? "#b91c1c" : "inherit" }}>
            {k}{wajib.has(k) ? " *" : ""}
          </code>
        ))}
        <br />
        {konfig.catatan}
      </div>

      <div style={{ marginTop: 14 }}>
        <SubmitButton className="btn-def" icon="ti-list-check" pendingText="Memeriksa…" name="langkah" value="periksa">
          Periksa file (belum disimpan)
        </SubmitButton>
      </div>

      {state.pesan && (
        <div role={state.langkah === "tersimpan" ? "status" : "alert"} className="p2ban" style={{
          marginTop: 12,
          background: state.langkah === "tersimpan" ? "#f0fdf4" : "#fef2f2",
          border: `.5px solid ${state.langkah === "tersimpan" ? "#86efac" : "#fca5a5"}`,
          color: state.langkah === "tersimpan" ? "#15803d" : "#b91c1c",
        }}>
          <i className={`ti ${state.langkah === "tersimpan" ? "ti-circle-check" : "ti-alert-circle"}`} /> {state.pesan}
        </div>
      )}

      {r && state.langkah !== "tersimpan" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Pratinjau — {r.jumlah.total} baris</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {URUT.map((s) => (
              <span key={s} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: LABEL[s].latar, color: LABEL[s].warna, fontWeight: 700 }}>
                {LABEL[s].teks}: {r.jumlah[s]}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--tm)", lineHeight: 1.7, marginBottom: 8 }}>
            Kolom dipetakan: {r.kolomDipetakan.map((k) => `${k.sumber} → ${k.tujuan}`).join(", ")}
            {r.kolomDiabaikan.length > 0 && <><br />Kolom diabaikan: {r.kolomDiabaikan.join(", ")}</>}
            {r.kolomSaldo.length > 0 && (
              <><br /><b style={{ color: "#b45309" }}>Kolom saldo tidak diimpor</b> ({r.kolomSaldo.join(", ")}; {r.barisBersaldo} baris berisi angka).
                Impor ini hanya daftar akun — saldo awal dicatat lewat menu Keuangan → Saldo Awal.</>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%", fontSize: 11 }}>
              <thead><tr><th>Baris</th><th>Kode</th><th>Nama</th><th>Tipe</th><th>Induk</th><th>Status</th><th>Keterangan</th></tr></thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={`${b.no}-${b.kode}`} style={{ background: LABEL[b.status].latar }}>
                    <td>{b.no}</td>
                    <td><code>{b.kode || "—"}</code></td>
                    <td>{b.nama}</td>
                    <td>{b.tipe}</td>
                    <td><code>{b.induk}</code></td>
                    <td style={{ color: LABEL[b.status].warna, fontWeight: 700 }}>{LABEL[b.status].teks}</td>
                    <td>
                      {b.alasan.map((a, i) => <div key={i}>{a}</div>)}
                      {b.solusi && <div style={{ color: "#1e40af" }}>Solusi: {b.solusi}</div>}
                      {b.perubahan.map((p) => (
                        <div key={p.kolom}>{p.kolom}: <s>{p.lama || "(kosong)"}</s> → <b>{p.baru || "(kosong)"}</b></div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!masihSama ? (
            <div className="p2ban" style={{ marginTop: 10 }}>
              <i className="ti ti-info-circle" /> Isi file berubah setelah diperiksa — klik Periksa lagi sebelum menyimpan.
            </div>
          ) : r.bolehSimpan ? (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {r.perluKonfirmasi && (
                <label style={{ fontSize: 11.5 }}>
                  <input type="checkbox" name="konfirmasi" value="1" /> Saya sudah meninjau {r.jumlah.berubah} perubahan pada akun yang
                  sudah ada di atas dan ingin menerapkannya.
                </label>
              )}
              <div>
                <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" name="langkah" value="simpan"
                  style={{ background: "var(--posb)" }}>
                  Simpan {r.jumlah.baru} akun baru{r.jumlah.berubah ? ` + ${r.jumlah.berubah} perubahan` : ""}
                </SubmitButton>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
                Disimpan sekaligus: kalau satu bagian gagal, tidak ada akun yang masuk. Tidak membuat saldo atau jurnal.
              </div>
            </div>
          ) : (
            <div className="p2ban" style={{ marginTop: 10 }}>
              <i className="ti ti-info-circle" />{" "}
              {r.jumlah.ditolak + r.jumlah.konflik > 0
                ? "File belum bisa disimpan: perbaiki baris yang ditolak/konflik di file, lalu periksa lagi. Tidak ada yang disimpan sebagian."
                : "Tidak ada akun baru atau perubahan — semua akun di file sudah sama dengan bagan akun KAMO."}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
