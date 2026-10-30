/**
 * Ledger lokal operator (K10): folder di LUAR repo (0700), berkas 0600, checkpoint atomik (tulis sementara -> fsync ->
 * rename -> fsync folder) dan kunci run eksklusif (`wx`).
 *
 * Isi TANPA PHI dan tanpa `source_key` mentah: hanya ID lokal, SHA-256 jejak, sidik payload, UUID hasil resolusi/DB, status,
 * dan kode alasan. Hash ID dan visit_id tetap metadata PSEUDONIM yang sensitif (bukan anonim) — simpan sebagai rahasia.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
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

export class BukuBesar {
  private constructor(readonly dir: string, readonly meta: MetaRun, private state: StateLedger) {}

  /**
   * Buka (atau buat) ledger. Menolak folder di dalam repo, meta yang berbeda (berkas/rencana/konteks/ukuran batch berubah),
   * dan kunci yang dipegang proses hidup. Kunci basi (proses mati, host sama) diambil alih dan dicatat.
   */
  static buka(dirInput: string, meta: MetaRun, opsi: { akarRepo?: string } = {}): { buku: BukuBesar; kunciBasiDiambil: boolean } {
    const dir = resolve(dirInput);
    if (opsi.akarRepo) {
      const rel = relative(resolve(opsi.akarRepo), dir);
      if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("Ledger tidak boleh di dalam repo.");
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if ((statSync(dir).mode & 0o077) !== 0) throw new Error("Folder ledger harus berizin 0700.");
    const kunci = join(dir, "run.lock");
    let kunciBasiDiambil = false;
    const isiKunci = JSON.stringify({ pid: process.pid, host: hostname() });
    try {
      const fd = openSync(kunci, "wx", 0o600);
      writeSync(fd, isiKunci); fsyncSync(fd); closeSync(fd);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let lama: { pid?: number; host?: string } = {};
      try { lama = JSON.parse(readFileSync(kunci, "utf8")); } catch { /* rusak -> tetap ditolak di bawah */ }
      if (lama.host !== hostname() || typeof lama.pid !== "number" || prosesHidup(lama.pid)) {
        throw new Error("Ledger sedang dipakai run lain (kunci eksklusif).");
      }
      unlinkSync(kunci);
      const fd = openSync(kunci, "wx", 0o600);
      writeSync(fd, isiKunci); fsyncSync(fd); closeSync(fd);
      kunciBasiDiambil = true;
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
      return { buku: new BukuBesar(dir, metaFinal, state), kunciBasiDiambil };
    } catch (e) {
      unlinkSync(kunci);
      throw e;
    }
  }

  baca(): StateLedger {
    return structuredClone(this.state);
  }

  /** Checkpoint tahan-crash. Dipanggil SEBELUM jaringan (status dikirim) dan sesudah validasi jawaban. */
  simpan(state: StateLedger) {
    tulisAtomik(this.dir, "state.json", JSON.stringify(state));
    this.state = structuredClone(state);
  }

  tutup() {
    const kunci = join(this.dir, "run.lock");
    if (existsSync(kunci)) unlinkSync(kunci);
  }
}
