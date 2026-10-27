"use client";

import { useFormStatus } from "react-dom";

// Tombol submit sadar-status: pas server action jalan, otomatis disabled + spinner
// biar staff gak double-klik / gak bingung apakah udah kepencet. Harus anak <form>.
// `busy` menahan tombol tetap terkunci setelah simpan berhasil sampai halaman
// berikutnya terbuka (U07) — jeda navigasi bukan undangan klik kedua.
export function SubmitButton({
  children, className, style, icon, pendingText = "Memproses…", formAction, name, value, disabled,
  busy = false, busyText = "Tersimpan, membuka halaman…",
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  icon?: string;
  pendingText?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
  disabled?: boolean;
  busy?: boolean;
  busyText?: string;
}) {
  const { pending } = useFormStatus();
  const locked = pending || busy;
  return (
    <button
      type="submit"
      formAction={formAction}
      name={name}
      value={value}
      disabled={locked || disabled}
      aria-busy={locked || undefined}
      className={className}
      style={{ ...style, ...(locked ? { opacity: 0.7, cursor: "wait" } : null) }}
    >
      {locked ? (
        <><span className="btn-spin" /> {pending ? pendingText : busyText}</>
      ) : (
        <>{icon && <i className={`ti ${icon}`} />} {children}</>
      )}
    </button>
  );
}
