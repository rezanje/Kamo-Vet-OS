/**
 * Ledger lokal operator (K10): folder di LUAR repo (0700), berkas 0600, checkpoint atomik (tulis sementara -> fsync ->
 * rename -> fsync folder) dan kunci run eksklusif (`wx`).
 *
 * Isi TANPA PHI dan tanpa `source_key` mentah: hanya ID lokal, SHA-256 jejak, sidik payload, UUID hasil resolusi/DB, status,
 * dan kode alasan. Hash ID dan visit_id tetap metadata PSEUDONIM yang sensitif (bukan anonim) — simpan sebagai rahasia.
 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import type { KonteksJaringan } from "./klien";

export type MetaRun = {
  runId: string;
  versiKontrak: string;
  sha256Berkas: string;
  sidikRencana: string;
  konteks: KonteksJaringan;
  ukuranBatch: number;
};

export type BarisLedger = { local_record_id: string; kunciHash: string; customer_id: string | null; pet_id: string | null; sidikPayload: string };
export type HasilLedger = { local_record_id: string; status: "tersimpan" | "sudah_ada" | "ditahan"; alasan: string | null; visit_id: string | null };
export type BatchLedger = {
  no: number;
  status: "dikirim" | "diakui" | "tidak_pasti";
  baris: BarisLedger[];
  hasil?: HasilLedger[];
  sebab?: string;
};
export type StateLedger = {
  batches: BatchLedger[];
  /** Ditahan sebelum RPC (identitas/demografi/kandidat berubah). Final untuk run ini. */
  ditahanIdentitas: { local_record_id: string; alasan: string[] }[];
};

const STATE_KOSONG: StateLedger = { batches: [], ditahanIdentitas: [] };

function tulisAtomik(dir: string, nama: string, isi: string) {
  const tujuan = join(dir, nama);
  const sementara = join(dir, `.${nama}.${process.pid}.tmp`);
  const fd = openSync(sementara, "w", 0o600);
  try {
    writeSync(fd, isi);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(sementara, tujuan);
  const dfd = openSync(dir, "r");
  try { fsyncSync(dfd); } finally { closeSync(dfd); }
}

function prosesHidup(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

type IsiKunci = { pid: number; host: string; token: string };

function bacaKunci(path: string): IsiKunci | null {
  try {
    const o = JSON.parse(readFileSync(path, "utf8")) as Partial<IsiKunci>;
    return typeof o.pid === "number" && typeof o.host === "string" && typeof o.token === "string" && o.token.length >= 16 ? (o as IsiKunci) : null;
  } catch {
    return null;
  }
}

function buatKunci(path: string, isi: IsiKunci) {
  const fd = openSync(path, "wx", 0o600);
  try { writeSync(fd, JSON.stringify(isi)); fsyncSync(fd); } finally { closeSync(fd); }
}

export type OpsiBuka = {
  akarRepo?: string;
  /**
   * Pemulihan EKSPLISIT kunci basi (proses pemegang mati, host sama): token persis dari pesan galat. Tanpa ini,
   * kunci yang ada selalu ditolak (tidak ada pengambilalihan otomatis).
   */
  pulihkanKunciBasi?: string;
  /** Khusus tes: disela setelah kunci basi dibaca (mensimulasikan pesaing). */
  _ujiSetelahBacaKunci?: () => void;
};

export class BukuBesar {
  private tertutup = false;
  private constructor(readonly dir: string, readonly meta: MetaRun, private state: StateLedger, private readonly token: string) {}

  /**
   * Buka (atau buat) ledger. Menolak folder di dalam repo, meta yang berbeda (berkas/rencana/konteks/ukuran batch berubah),
   * dan kunci yang ada. Kunci basi hanya dipulihkan bila operator memberi tokennya persis (`pulihkanKunciBasi`), pemegangnya
   * mati, dan host sama; pengambilalihan memakai rename atomik sehingga hanya satu pesaing yang menang. Kunci rusak atau milik
   * host lain selalu ditolak.
   */
  static buka(dirInput: string, meta: MetaRun, opsi: OpsiBuka = {}): { buku: BukuBesar; kunciBasiDipulihkan: boolean } {
    const dir = resolve(dirInput);
    if (opsi.akarRepo) {
      const rel = relative(resolve(opsi.akarRepo), dir);
      if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("Ledger tidak boleh di dalam repo.");
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if ((statSync(dir).mode & 0o077) !== 0) throw new Error("Folder ledger harus berizin 0700.");
    const kunci = join(dir, "run.lock");
    const milikku: IsiKunci = { pid: process.pid, host: hostname(), token: randomUUID() };
    let kunciBasiDipulihkan = false;
    try {
      buatKunci(kunci, milikku);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const lama = bacaKunci(kunci);
      if (!lama) throw new Error("Kunci ledger rusak; periksa manual (tidak diambil alih).");
      if (lama.host !== hostname()) throw new Error("Kunci ledger milik host lain; periksa manual (tidak diambil alih).");
      if (prosesHidup(lama.pid)) throw new Error("Ledger sedang dipakai run lain (kunci eksklusif).");
      if (opsi.pulihkanKunciBasi !== lama.token) {
        throw new Error(`Kunci basi terdeteksi (token ${lama.token}). Pulihkan hanya secara eksplisit setelah memastikan run lama berhenti.`);
      }
      opsi._ujiSetelahBacaKunci?.();
      const arsip = join(dir, `.run.lock.basi.${milikku.token}`);
      try {
        renameSync(kunci, arsip);                       // atomik: hanya satu pesaing yang berhasil memindahkannya
      } catch {
        throw new Error("Kunci basi sudah diambil pesaing lain.");
      }
      const dipindah = bacaKunci(arsip);
      if (!dipindah || dipindah.token !== lama.token) {
        // Yang terpindah bukan kunci basi yang diperiksa (pemilik baru masuk di sela): kembalikan tanpa menimpa.
        try { linkSync(arsip, kunci); unlinkSync(arsip); } catch { /* kunci lain sudah ada; arsip disimpan sebagai bukti */ }
        throw new Error("Kunci berubah saat dipulihkan; tidak diambil alih.");
      }
      try {
        buatKunci(kunci, milikku);
      } catch {
        throw new Error("Kunci baru sudah dibuat pesaing lain.");
      }
      unlinkSync(arsip);
      kunciBasiDipulihkan = true;
    }
    try {
      const metaPath = join(dir, "run.json");
      let metaFinal = meta;
      if (existsSync(metaPath)) {
        const lama = JSON.parse(readFileSync(metaPath, "utf8")) as MetaRun;
        const beda = (["versiKontrak", "sha256Berkas", "sidikRencana", "ukuranBatch"] as const).filter((k) => lama[k] !== meta[k]);
        if (JSON.stringify(lama.konteks) !== JSON.stringify(meta.konteks)) beda.push("konteks" as never);
        if (beda.length) throw new Error(`Lanjutkan ditolak: ${beda.join(", ")} berubah. Perubahan wajib lewat rencana tertinjau baru.`);
        metaFinal = lama;
      } else {
        tulisAtomik(dir, "run.json", JSON.stringify(meta, null, 1));
      }
      const statePath = join(dir, "state.json");
      const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as StateLedger) : structuredClone(STATE_KOSONG);
      return { buku: new BukuBesar(dir, metaFinal, state, milikku.token), kunciBasiDipulihkan };
    } catch (e) {
      const isi = bacaKunci(kunci);
      if (isi?.token === milikku.token) unlinkSync(kunci);
      throw e;
    }
  }

  baca(): StateLedger {
    if (this.tertutup) throw new Error("Ledger sudah ditutup.");
    return structuredClone(this.state);
  }

  /** Checkpoint tahan-crash. Dipanggil SEBELUM jaringan (status dikirim) dan sesudah validasi jawaban. */
  simpan(state: StateLedger) {
    if (this.tertutup) throw new Error("Ledger sudah ditutup.");
    const isi = bacaKunci(join(this.dir, "run.lock"));
    if (isi?.token !== this.token) throw new Error("Kunci ledger bukan milik run ini lagi; berhenti tanpa menulis.");
    tulisAtomik(this.dir, "state.json", JSON.stringify(state));
    this.state = structuredClone(state);
  }

  /** Idempoten; hanya melepas kunci bila tokennya milik pemanggil ini (tidak pernah menghapus kunci pemilik baru). */
  tutup() {
    if (this.tertutup) return;
    this.tertutup = true;
    const kunci = join(this.dir, "run.lock");
    if (bacaKunci(kunci)?.token === this.token) unlinkSync(kunci);
  }
}
