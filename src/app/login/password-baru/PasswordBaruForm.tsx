"use client";

import { useActionState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { PasswordInput } from "@/components/PasswordInput";
import { PASSWORD_MAX, PASSWORD_MIN, bacaTokenPemulihan, type TokenPemulihan } from "@/lib/lupa-password";
import { Pesan } from "../KartuMasuk";
import { simpanPasswordBaru } from "../lupa-password/actions";

// Token dibaca SEKALI dari bagian # lalu dihapus dari alamat (tidak tertinggal di riwayat/tangkapan layar).
// Store kecil di luar React: useSyncExternalStore, bukan setState di dalam useEffect.
let token: TokenPemulihan | null = null;
function ambilToken(): TokenPemulihan {
  if (token) return token;
  token = bacaTokenPemulihan(window.location.hash);
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}
type Keadaan = TokenPemulihan | { status: "memuat" };
const MEMUAT: Keadaan = { status: "memuat" };
// Link baru yang dibuka di tab yang sama hanya mengubah bagian # (halaman tidak dimuat ulang): baca ulang.
function langganan(beri: () => void) {
  const ubah = () => { if (window.location.hash) { token = null; beri(); } };
  window.addEventListener("hashchange", ubah);
  return () => window.removeEventListener("hashchange", ubah);
}

export function PasswordBaruForm() {
  const t = useSyncExternalStore<Keadaan>(langganan, ambilToken, () => MEMUAT);
  const [hasil, aksi] = useActionState(simpanPasswordBaru, null);
  const router = useRouter();
  useEffect(() => {
    if (hasil?.ok) router.replace("/login?reset=ok");
  }, [hasil, router]);

  if (t.status === "memuat") return <p style={{ fontSize: 12, margin: 0 }}>Memeriksa link…</p>;
  if (t.status !== "ok") {
    return <>
      <Pesan ok={false}>{t.status === "galat" ? t.message : "Link tidak lengkap. Buka lagi link dari email, atau minta link baru."}</Pesan>
      <Link href="/login/lupa-password" className="btn-acc" style={{ justifyContent: "center", background: "var(--posb)", padding: "10px 0", fontSize: 13, textAlign: "center" }}>
        Minta link baru
      </Link>
    </>;
  }
  return (
    <form action={aksi} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {hasil && <Pesan ok={hasil.ok}>{hasil.ok ? "Password baru tersimpan. Membuka halaman masuk…" : hasil.message}</Pesan>}
      <input type="hidden" name="access_token" value={t.accessToken} />
      <input type="hidden" name="refresh_token" value={t.refreshToken} />
      <div className="fg">
        <label className="flab">Password baru (min. {PASSWORD_MIN} karakter)</label>
        <PasswordInput name="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" />
      </div>
      <div className="fg">
        <label className="flab">Ulangi password baru</label>
        <PasswordInput name="password_konfirmasi" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" />
      </div>
      <SubmitButton busy={hasil?.ok === true} busyText="Tersimpan, membuka halaman masuk…" className="btn-acc"
        style={{ width: "100%", justifyContent: "center", background: "var(--posb)", padding: "10px 0", fontSize: 13 }} pendingText="Menyimpan…">
        Simpan password baru
      </SubmitButton>
      {hasil && !hasil.ok && <Link href="/login/lupa-password" style={{ fontSize: 11.5, textAlign: "center" }}>Minta link baru</Link>}
    </form>
  );
}
