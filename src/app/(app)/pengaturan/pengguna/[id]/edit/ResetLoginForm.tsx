"use client";

import { useState } from "react";
import { resetLoginPengguna, type ResetLoginResult } from "../../actions";

// U13: hanya dirender untuk Super Admin. Kosongkan kolom yang tidak ingin diubah.
export function ResetLoginForm({ profileId, emailSekarang }: { profileId: string; emailSekarang: string | null }) {
  const [hasil, setHasil] = useState<ResetLoginResult | null>(null);
  const [pending, setPending] = useState(false);
  const [lihat, setLihat] = useState(false);
  const [password, setPassword] = useState("");
  const [ulang, setUlang] = useState("");
  const kirim = async (form: HTMLFormElement) => {
    setPending(true);
    setHasil(null);
    try {
      const res = await resetLoginPengguna(new FormData(form));
      setHasil(res);
      if (res.ok) { setPassword(""); setUlang(""); }
    } catch {
      setHasil({ ok: false, message: "Hasil reset belum dapat dipastikan. Muat ulang halaman sebelum mengulang." });
    } finally {
      setPending(false);
    }
  };
  return (
    <form method="post" className="crm-sec" onSubmit={(e) => { e.preventDefault(); void kirim(e.currentTarget); }}>
      <input type="hidden" name="profile_id" value={profileId} />
      {hasil && <p role={hasil.ok ? "status" : "alert"} className="p2ban"
        style={hasil.ok ? { color: "#15803d", background: "#e8f5ee" } : { color: "#b91c1c", background: "#fef2f2" }}>{hasil.message}</p>}
      <p style={{ fontSize: 12, color: "var(--tm)" }}>
        Email login saat ini: <b>{emailSekarang ?? "—"}</b>. Isi hanya bagian yang ingin diganti. Setelah disimpan,
        karyawan otomatis keluar dari semua perangkat dan harus masuk ulang dengan data baru.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label className="flab">Email login baru
          <input className="fi" type="email" name="email" autoComplete="off" maxLength={254} disabled={pending}
            defaultValue={emailSekarang ?? ""} />
        </label>
        <label className="flab">Password baru (min. 8 karakter)
          {lihat
            ? <input className="fi" type="text" name="password" autoComplete="off" minLength={8} maxLength={72} disabled={pending} value={password} onChange={(e) => setPassword(e.target.value)} />
            : <input className="fi" type="password" name="password" autoComplete="new-password" minLength={8} maxLength={72} disabled={pending} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </label>
        <label className="flab">Ulangi password baru
          {lihat
            ? <input className="fi" type="text" name="password_konfirmasi" autoComplete="off" maxLength={72} disabled={pending} value={ulang} onChange={(e) => setUlang(e.target.value)} />
            : <input className="fi" type="password" name="password_konfirmasi" autoComplete="new-password" maxLength={72} disabled={pending} value={ulang} onChange={(e) => setUlang(e.target.value)} />}
        </label>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 8 }}>
        <input type="checkbox" checked={lihat} onChange={(e) => setLihat(e.target.checked)} /> Tampilkan password
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="submit" className="btn-acc" disabled={pending}>{pending ? "Menyimpan…" : "Simpan email / password"}</button>
      </div>
    </form>
  );
}
