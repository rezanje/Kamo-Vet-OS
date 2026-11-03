"use client";
import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { effectiveAllowedActions, ROLE_ACCESS_CATALOG, roleAccessScope, type RoleAccessConfig } from "@/lib/role-access-catalog";
import { roleCapabilities } from "@/lib/role-capabilities";
import { saveRoleSettings } from "./actions";

export function NewRoleSettingsForm({ userId, config, canEdit }: { userId: string; config: RoleAccessConfig; canEdit: boolean }) {
  const [mode, setMode] = useState("custom");
  const defaults = roleCapabilities(config.role);
  const enforced = config.action_catalog.filter(a => a.enforced);
  const unavailable = config.action_catalog.filter(a => !a.enforced);
  // The EFFECTIVE policy: no saved policy ("legacy") allows every enforced action, an explicit policy only its list.
  const allowed = new Set(effectiveAllowedActions(config));
  return <CorrectionTransactionForm userId={userId} scope={roleAccessScope(config.role, config.revision)} action={saveRoleSettings.bind(null, config.role, config.revision)}
    uncertainNotice="Hasil simpan pengaturan belum terkonfirmasi. Isian dan kunci permintaan tetap tersedia. Muat ulang halaman untuk memeriksa pengaturan saat ini sebelum menyimpan ulang; menyimpan ulang dengan kunci yang sama aman.">
    {({ ready }) => <fieldset disabled={!canEdit || !ready} style={{ border: 0, padding: 0 }}>
      <legend>Hak buka menu untuk {config.role}</legend>
      <input type="hidden" name="role" value={config.role} />
      <input type="hidden" name="expected_revision" value={config.revision} />
      <p>Centang mengatur hak buka menu: sidebar, pintasan, dan URL langsung. Hak buka menu bukan izin menjalankan tindakan bisnis. Tindakan yang sudah terhubung diatur terpisah di bawah; cakupan lainnya belum tersedia.</p>
      {config.source === "legacy" && <p role="note">Aturan lama tetap berlaku sampai disimpan. Saat menyimpan, grup operasional menjadi pilihan eksplisit; periksa Kasir, Quest, dan Shift.</p>}
      {["Modul", "Operasional"].map(group => <section key={group} aria-label={group}>
        <h3>{group}</h3>
        {group === "Operasional" && <p>Quest Staff mengaktifkan quest, tetapi tiap halaman juga butuh areanya: /kasir/quest butuh Kasir, /pos/quest (konfigurasi) butuh modul POS. Kasir atau POS saja tidak membuka quest.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
          {ROLE_ACCESS_CATALOG.filter(m => m.group === group).map(m => <label key={m.id}><input type="checkbox" name={`mod_${m.id}`} defaultChecked={config.modules.includes(m.id)} /> {m.label}</label>)}
        </div>
      </section>)}
      <section aria-label="Tindakan bisnis">
        <h3>Tindakan bisnis</h3>
        <p>Hanya tindakan yang telah terhubung dengan pengamanan server yang ditampilkan sebagai pilihan. Tidak ada izin CRUD umum atau perluasan hak otomatis.</p>
        {config.actions.source === "legacy" && <p role="note">Peran ini belum punya kebijakan tindakan tersimpan, sehingga semua tindakan yang terhubung saat ini diizinkan (dicentang). Menyimpan tanpa mengubah centang tindakan tidak mengubah kebijakan tindakan; menghapus centang membuat kebijakan eksplisit. Pilihan bawaan tidak menaikkan hak peran: batas peran, status transaksi, cabang, shift, dan kewenangan klinis tetap wajib dipenuhi.</p>}
        {[...new Set(enforced.map(a => a.group))].map(group => <section key={group} aria-label={`Tindakan ${group}`}>
          <h4>{group}</h4>
          {enforced.filter(a => a.group === group).map(a => <label key={a.id} style={{ display: "block" }}><input type="checkbox" name={`act_${a.id}`} defaultChecked={allowed.has(a.id)} /> {a.label}</label>)}
        </section>)}
        {!enforced.length && <p>Belum ada tindakan bisnis yang tersedia untuk diatur.</p>}
        {unavailable.length > 0 && <div role="note"><strong>Belum tersedia:</strong> {unavailable.length} tindakan yang direncanakan belum terhubung sepenuhnya; tidak dapat diberikan dari halaman ini.<details><summary>Lihat cakupan yang belum tersedia</summary><ul>{unavailable.map(a => <li key={a.id}>{a.group} — {a.label}</li>)}</ul></details></div>}
        <p>Batas yang dilindungi: mengubah kebijakan hak akses serta harga/diskon transaksi manual tetap khusus OWNER aktif. Pilihan tindakan tidak menggantikan batas peran asli, cabang, shift, status, akuntansi, stok, dan klinis; promo kasir yang sah tetap mengikuti aturan asal.</p>
      </section>
      <h3>Hak cabang &amp; akun</h3>
      <label style={{ display: "block" }}><input type="checkbox" name="all_branches" defaultChecked={config.capabilities.all_branches} /> Akses semua cabang</label>
      <label style={{ display: "block" }}><input type="checkbox" name="create_accounts" defaultChecked={config.capabilities.create_accounts} /> Boleh menambahkan akun karyawan</label>
      <p>OWNER selalu penuh dan tidak dapat dibatasi. Pilihan tanpa menu menolak semua menu kecuali halaman pemulihan pribadi/login.</p>
      <label>Jenis penyimpanan <select name="mode" value={mode} onChange={e => setMode(e.target.value)} data-draft-ignore><option value="custom">Simpan pilihan khusus</option><option value="reset">Reset SEMUA pengaturan ke bawaan</option></select></label>
      <div role="note"><strong>Peringatan reset SEMUA:</strong> pilihan menu khusus, tindakan bisnis khusus, serta hak cabang dan akun akan dihapus. Bawaan {config.role}: semua cabang {defaults.all_branches ? "ya" : "tidak"}; membuat akun {defaults.create_accounts ? "ya" : "tidak"}. Akses menu kembali ke aturan bawaan sistem dan bisa bertambah atau berkurang. Tindakan kembali ke aturan lama tanpa menghapus batas peran asli.</div>
      <label style={{ display: "block" }}><input type="checkbox" name="confirm_reset" data-draft-ignore /> Saya mengonfirmasi reset SEMUA menu, tindakan, cabang, dan akun jika memilih reset.</label>
      <label style={{ display: "block" }}>Alasan perubahan <textarea name="reason" required minLength={3} maxLength={1000} className="fi" /></label>
      {canEdit && <SubmitButton className="btn-acc" disabled={!ready} pendingText="Menyimpan…">{mode === "reset" ? "Reset SEMUA pengaturan" : `Simpan pengaturan ${config.role}`}</SubmitButton>}
    </fieldset>}
  </CorrectionTransactionForm>;
}
