"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * Kolom password dengan tombol mata untuk melihat/menyembunyikan isian
 * (permintaan tim toko 2026-11-01: memastikan password yang diketik sudah benar).
 * Default tetap tersembunyi.
 */
export function PasswordInput({ className = "fi", style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [lihat, setLihat] = useState(false);
  return (
    <span style={{ position: "relative", display: "block" }}>
      {/* Elemen <input> yang sama (posisi & jenis sama), jadi isian tidak hilang saat dibolak-balik. */}
      {lihat
        ? <input {...props} className={className} type="text" style={{ ...style, paddingRight: 34 }} />
        : <input {...props} className={className} type="password" style={{ ...style, paddingRight: 34 }} />}
      <button
        type="button"
        onClick={() => setLihat((v) => !v)}
        aria-label={lihat ? "Sembunyikan password" : "Lihat password"}
        aria-pressed={lihat}
        title={lihat ? "Sembunyikan password" : "Lihat password"}
        style={{
          position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
          border: 0, background: "transparent", cursor: "pointer", padding: "4px 6px",
          color: "var(--td)", fontSize: 15, lineHeight: 1,
        }}
      >
        <i className={lihat ? "ti ti-eye-off" : "ti ti-eye"} aria-hidden />
      </button>
    </span>
  );
}
