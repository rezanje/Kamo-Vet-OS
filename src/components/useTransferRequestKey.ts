"use client";
import { useRef, useState } from "react";
import { usePreservedAction, type ActionRejection } from "@/components/LocalTransactionDraft";
import { TRANSFER_KEY_UNRESOLVED_MESSAGE } from "@/lib/transfer-key";

const isRedirect = (error: unknown) => typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");

/**
 * Kunci simpan pemindahan (`request_key`) hidup HANYA di memori halaman ini; tidak pernah ikut disimpan atau
 * dipulihkan dari draf browser. Draf lama yang dipulihkan membawa kunci dokumen yang sudah tersimpan, lalu isian
 * baru ditolak database ("Kunci pengiriman sudah dipakai") berulang-ulang.
 *
 * - Kunci stabil di antara render dan antara penekanan Simpan pertama dan percobaan ulang (klik ganda/jaringan putus).
 * - Kunci diganti setelah simpan terkonfirmasi (`rotate`, dipanggil dari reset draf) dan setelah server menjawab
 *   penolakan pasti `stale_request_key` (dokumen lain memiliki kunci itu: tidak ada yang tertulis untuk isian ini).
 * - TIDAK diganti otomatis bila percobaan sebelumnya dengan kunci yang sama belum jelas hasilnya (galat dilempar /
 *   respons kosong): jawaban "kunci dipakai" bisa berarti dokumen SAYA sendiri sudah tersimpan lalu isian diubah,
 *   dan mengganti kunci akan menyimpan dua kali. Petugas diperingatkan dulu; penekanan berikutnya mengganti kunci.
 */
export function useTransferRequestKey(action: (data: FormData) => Promise<void | ActionRejection>) {
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const unresolved = useRef(new Set<string>());
  const warned = useRef(new Set<string>());
  const rotate = (submitted?: string) => setRequestKey(current => {
    if (submitted !== undefined && current !== submitted) return current;
    unresolved.current.clear(); warned.current.clear();
    return crypto.randomUUID();
  });
  const guarded = async (data: FormData): Promise<void | ActionRejection> => {
    const submitted = String(data.get("request_key") ?? "");
    const earlierUnresolved = unresolved.current.has(submitted);
    let result: void | ActionRejection;
    try { result = await action(data); }
    catch (error) {
      if (!isRedirect(error)) unresolved.current.add(submitted);
      throw error;
    }
    if (result === undefined) unresolved.current.add(submitted);
    if ((result as { code?: string } | undefined)?.code === "stale_request_key") {
      if (earlierUnresolved && !warned.current.has(submitted)) {
        warned.current.add(submitted);
        return { ok: false, outcome: "rejected", message: TRANSFER_KEY_UNRESOLVED_MESSAGE };
      }
      rotate(submitted);
    }
    return result;
  };
  const { save, failure } = usePreservedAction(guarded);
  return { requestKey, save, failure, rotate: () => rotate() };
}
