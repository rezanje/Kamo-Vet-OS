"use client";

// E3 (meeting 12 Nov 2026): editor "Akses khusus akun ini" (hanya dirender untuk Owner aktif).
// Daftar menu & sub-menu sama dengan layar Akses Grup (komponen SubmenuPicker yang sama).
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AksesAkun } from "@/lib/akses-akun";
import { LABEL_MODE, type ModeForm } from "@/lib/akses-akun-form";
import { ROLE_ACCESS_CATALOG } from "@/lib/role-access-catalog";
import { selectableSubmenus } from "@/lib/submenu-access";
import { SubmenuPicker } from "../../../akses-grup/submenuPicker";
import { simpanAksesKhususAkun, type HasilAksesKhusus } from "../../akses-khusus-actions";

const PENJELASAN: Record<ModeForm, string> = {
  ikuti: "Akun ini memakai akses perannya saja (seperti akun lain dengan peran yang sama).",
  tambah: "Akun ini mendapat akses perannya DITAMBAH menu yang dicentang di bawah.",
  khusus: "Akun ini HANYA bisa membuka menu yang dicentang di bawah; menu bawaan perannya tidak dipakai.",
};

export function AksesKhususForm({ profileId, role, requestKey, current }: { profileId: string; role: string; requestKey: string; current: AksesAkun | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<ModeForm>(current?.mode ?? "ikuti");
  const [hasil, setHasil] = useState<HasilAksesKhusus | null>(null);
  const [pending, setPending] = useState(false);
  const kirim = async (form: HTMLFormElement) => {
    const data = new FormData(form); // sebelum fieldset dinonaktifkan (input nonaktif tidak ikut terkirim)
    setPending(true);
    setHasil(null);
    try {
      const res = await simpanAksesKhususAkun(data);
      setHasil(res);
      if (res.ok) router.refresh();
    } catch {
      setHasil({ ok: false, message: "Hasil simpan belum dapat dipastikan. Muat ulang halaman untuk melihat akses yang berlaku sekarang." });
    } finally {
      setPending(false);
    }
  };
  const dicentang = (id: string) => !!current && Object.hasOwn(current.modules, id);
  return (
    <form method="post" className="crm-sec" data-akses-khusus onSubmit={(e) => { e.preventDefault(); void kirim(e.currentTarget); }}>
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="request_key" value={requestKey} />
      {hasil && <p role={hasil.ok ? "status" : "alert"} className="p2ban"
        style={hasil.ok ? { color: "#15803d", background: "#e8f5ee" } : { color: "#b91c1c", background: "#fef2f2" }}>{hasil.message}</p>}
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 12, color: "var(--tm)" }}>Peran akun ini: <b>{role}</b>. Pilih cara akun ini membuka menu:</legend>
        {(["ikuti", "tambah", "khusus"] as const).map(m => (
          <label key={m} style={{ display: "block", margin: "4px 0" }}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} /> <b>{LABEL_MODE[m]}</b>
            <span style={{ fontSize: 11.5, color: "var(--tm)" }}> — {PENJELASAN[m]}</span>
          </label>
        ))}
        {/* Disembunyikan (bukan dihapus) saat "Ikuti peran", supaya centang tidak hilang bila Owner berganti pilihan. */}
        <fieldset hidden={mode === "ikuti"} style={{ border: 0, padding: 0, margin: "8px 0" }} data-daftar-menu>
          {["Modul", "Operasional"].map(group => <section key={group} aria-label={group}>
            <h4 style={{ margin: "8px 0 4px" }}>{group}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 8, alignItems: "start" }}>
              {ROLE_ACCESS_CATALOG.filter(m => m.group === group).map(m => <div key={m.id}>
                <label><input type="checkbox" name={`mod_${m.id}`} defaultChecked={dicentang(m.id)} /> {m.label}</label>
                {selectableSubmenus(m.id).length > 0 && <SubmenuPicker moduleId={m.id} moduleLabel={m.label}
                  allowed={current?.modules[m.id] ?? undefined} moduleChecked={dicentang(m.id)} />}
              </div>)}
            </div>
          </section>)}
        </fieldset>
        <p role="note" style={{ fontSize: 11.5, color: "var(--tm)" }}>
          Ini mengatur menu yang bisa dibuka. Hak simpan/posting tetap mengikuti peran akun dan akses cabangnya. Untuk menu
          Penjualan (termasuk Penjualan Online) akun ini juga diizinkan menyimpan transaksi penjualan di cabangnya. Akun OWNER
          selalu penuh. Halaman Dashboard Pribadi selalu bisa dibuka.
        </p>
        <label className="flab" style={{ display: "block" }}>Alasan perubahan (opsional)
          <textarea name="reason" maxLength={1000} className="fi" rows={2} placeholder="mis. Staf khusus Penjualan Online Shopee" />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button type="submit" className="btn-acc" disabled={pending}>{pending ? "Menyimpan…" : "Simpan akses akun ini"}</button>
        </div>
      </fieldset>
    </form>
  );
}
