"use client";

import { useFormStatus } from "react-dom";

// Tombol 'Salin promo' di baris daftar: terkunci selama salinan dibuat, supaya klik dua kali
// tidak membuat dua draf "Salinan dari …". Harus anak <form>.
export function SalinPromoButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-def" disabled={pending} aria-busy={pending || undefined} style={{ padding: "3px 10px", fontSize: 10, ...(pending ? { opacity: 0.7, cursor: "wait" } : null) }} title="Buat salinan promo ini sebagai draf baru (nonaktif)">
      {pending ? "Menyalin…" : "Salin promo"}
    </button>
  );
}
