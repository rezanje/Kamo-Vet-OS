"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { PasswordInput } from "@/components/PasswordInput";

export function PasswordForm({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  return (
    <form action={action} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      <label style={{ fontSize: 11 }}>Password saat ini<PasswordInput name="password_lama" autoComplete="current-password" required /></label>
      <label style={{ fontSize: 11 }}>Password baru<PasswordInput name="password_baru" autoComplete="new-password" minLength={8} required /></label>
      <label style={{ fontSize: 11 }}>Ulangi password baru<PasswordInput name="konfirmasi_password" autoComplete="new-password" minLength={8} required /></label>
      <SubmitButton className="btn-acc" pendingText="Menyimpan…" style={{ justifySelf: "start" }}>Ubah Password</SubmitButton>
    </form>
  );
}
