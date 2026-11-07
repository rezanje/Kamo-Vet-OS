import type { KeyboardEvent } from "react";

// Tombol yang memang boleh dipencet dengan Enter (fokus keyboard di tombolnya sendiri).
const TOMBOL = new Set(["submit", "button", "reset", "image"]);

/**
 * Babibu 3 Nov: tekan Enter di kolom satu baris (Keluhan, Berat, cari obat / scan
 * barcode, Qty, …) memicu "implicit submission" browser — form langsung tersimpan lewat
 * tombol simpan pertama dan pindah ke Resep / Pembayaran padahal pemeriksaan belum
 * selesai diisi. Pasang di `onKeyDown` <form> klinis supaya simpan hanya lewat klik
 * tombol. Textarea tetap membuat baris baru; tombol yang difokus tetap bisa di-Enter;
 * handler Enter milik kolom anak tetap jalan (tidak ada stopPropagation).
 */
export function cegahEnterSimpan(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  const target = event.target;
  if (target instanceof HTMLInputElement && !TOMBOL.has(target.type)) event.preventDefault();
}
