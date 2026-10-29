"use client";

// Pembungkus pengurai kartu medis: pakai Web Worker bila tersedia, jatuh ke tab bila tidak.
//
// Tanpa worker impor tetap jalan -- hanya tabnya terasa berat. Karena itu kegagalan
// membuat worker tidak boleh menghentikan impor.

import { tanganiUraiRekamMedis, type BerkasUraiRekamMedis, type JawabanUraiRekamMedis, type PermintaanUraiRekamMedis } from "./impor-rekam-medis-urai";
import type { RekamMedisWorkbookResult } from "./impor-rekam-medis";

export type PenguraiKartuMedis = {
  diWorker: boolean;
  urai(berkas: BerkasUraiRekamMedis[]): Promise<RekamMedisWorkbookResult>;
  tutup(): void;
};

type PekerjaUrai = {
  postMessage(pesan: PermintaanUraiRekamMedis, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(tipe: "message" | "error" | "messageerror", pendengar: (event: unknown) => void): void;
};

function workerBawaan(): PekerjaUrai | null {
  try {
    if (typeof Worker === "undefined") return null;
    return new Worker(new URL("./impor-rekam-medis.worker.ts", import.meta.url), { type: "module" }) as unknown as PekerjaUrai;
  } catch {
    return null;
  }
}

function pesanJawaban(event: unknown): JawabanUraiRekamMedis | null {
  const data = (event as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object" || typeof (data as { id?: unknown }).id !== "number") return null;
  return data as JawabanUraiRekamMedis;
}

export function buatPenguraiKartuMedis(opsi: { buatWorker?: () => PekerjaUrai | null } = {}): PenguraiKartuMedis {
  const pekerja = (opsi.buatWorker ?? workerBawaan)();
  if (!pekerja) {
    return {
      diWorker: false,
      async urai(berkas) {
        const jawaban = await tanganiUraiRekamMedis({ id: 0, berkas });
        if (!jawaban.ok) throw new Error(jawaban.pesan);
        return jawaban.hasil;
      },
      tutup() {},
    };
  }

  const menunggu = new Map<number, { selesai: (hasil: RekamMedisWorkbookResult) => void; gagal: (cause: Error) => void }>();
  let berikutnya = 1;
  let tertutup = false;

  const gagalkanSemua = (pesan: string) => {
    for (const [, janji] of menunggu) janji.gagal(new Error(pesan));
    menunggu.clear();
  };

  pekerja.addEventListener("message", (event) => {
    const jawaban = pesanJawaban(event);
    if (!jawaban) return;
    const janji = menunggu.get(jawaban.id);
    if (!janji) return;
    menunggu.delete(jawaban.id);
    if (jawaban.ok) janji.selesai(jawaban.hasil);
    else janji.gagal(new Error(jawaban.pesan));
  });
  pekerja.addEventListener("error", () => gagalkanSemua("Pembaca kartu medis berhenti. Coba lanjutkan lagi."));
  pekerja.addEventListener("messageerror", () => gagalkanSemua("Data kartu medis tidak terkirim ke pembaca."));

  return {
    diWorker: true,
    urai(berkas) {
      if (tertutup) return Promise.reject(new Error("Pembaca kartu medis sudah ditutup."));
      const id = berikutnya++;
      return new Promise<RekamMedisWorkbookResult>((selesai, gagal) => {
        menunggu.set(id, { selesai, gagal });
        // Pindahkan kepemilikan buffer supaya 8 MB tidak disalin dua kali per potongan.
        const transfer = berkas.map((item) => item.bytes.buffer).filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
        try {
          pekerja.postMessage({ id, berkas }, transfer);
        } catch (cause) {
          menunggu.delete(id);
          gagal(cause instanceof Error ? cause : new Error("Kartu medis gagal dikirim ke pembaca."));
        }
      });
    },
    tutup() {
      tertutup = true;
      gagalkanSemua("Impor dihentikan.");
      pekerja.terminate();
    },
  };
}
