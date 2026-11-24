"use client";

import { useEffect } from "react";
import { PATH_PASSWORD_BARU, hashPemulihan } from "@/lib/lupa-password";

// Cadangan: bila alamat halaman password baru belum didaftarkan di Supabase, link email jatuh ke alamat utama
// aplikasi, lalu (tanpa sesi) dibelokkan ke /login dengan bagian # tetap terbawa. Teruskan ke halaman yang benar.
export function TerusanPemulihan() {
  useEffect(() => {
    if (hashPemulihan(window.location.hash)) window.location.replace(PATH_PASSWORD_BARU + window.location.hash);
  }, []);
  return null;
}
