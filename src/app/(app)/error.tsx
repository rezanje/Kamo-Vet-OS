"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";

// Pengganti layar "Application error" bawaan: menu tetap tampil, pengguna bisa coba lagi.
// refresh() mengambil ulang data server; reset() saja hanya merender ulang galat yang sama.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return <div className="crm-sec" role="alert">
    <p>Halaman ini belum berhasil dimuat. Server mungkin sedang sibuk — coba muat ulang sebentar lagi.</p>
    <button type="button" className="btn-def" onClick={() => startTransition(() => { router.refresh(); reset(); })}>Muat ulang</button>
  </div>;
}
