"use client";

import { useFormStatus } from "react-dom";

// Tombol submit sadar-status: pas server action jalan, otomatis disabled + spinner
// biar staff gak double-klik / gak bingung apakah udah kepencet. Harus anak <form>.
export function SubmitButton({
  children, className, style, icon, pendingText = "Memproses…", formAction, name, value, disabled,
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
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      name={name}
      value={value}
      disabled={pending || disabled}
      className={className}
      style={{ ...style, ...(pending ? { opacity: 0.7, cursor: "wait" } : null) }}
    >
      {pending ? (
        <><span className="btn-spin" /> {pendingText}</>
      ) : (
        <>{icon && <i className={`ti ${icon}`} />} {children}</>
      )}
    </button>
  );
}
