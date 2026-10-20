"use client";

import { SubmitButton } from "@/components/SubmitButton";

export function PasswordForm({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  return (
    <form action={action} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      <label style={{ fontSize: 11 }}>Password saat ini<input className="fi" name="password_lama" type="password" autoComplete="current-password" required /></label>
      <label style={{ fontSize: 11 }}>Password baru<input className="fi" name="password_baru" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label style={{ fontSize: 11 }}>Ulangi password baru<input className="fi" name="konfirmasi_password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <SubmitButton className="btn-acc" pendingText="Menyimpan…" style={{ justifySelf: "start" }}>Ubah Password</SubmitButton>
    </form>
  );
}
