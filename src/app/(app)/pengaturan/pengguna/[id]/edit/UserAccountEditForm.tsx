"use client";

import { useState } from "react";
import type { UserAccountEditBranch, UserAccountEditSnapshot } from "@/lib/user-account-edit";
import { simpanEditPengguna } from "../../actions";

export function UserAccountEditForm({ snapshot, branches, requestId }: {
  snapshot: UserAccountEditSnapshot;
  branches: UserAccountEditBranch[];
  requestId: string;
}) {
  const [fullName, setFullName] = useState(snapshot.full_name ?? "");
  const [role, setRole] = useState(snapshot.role);
  const [branchIds, setBranchIds] = useState(snapshot.branch_ids);
  const [saveRequestId] = useState(requestId);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const save = async (form: FormData) => {
    setPending(true);
    setMessage("");
    try {
      const result = await simpanEditPengguna(form);
      if (result?.ok === false) setMessage(result.message);
    } catch {
      setMessage("Hasil simpan belum dapat dipastikan. Isian tetap ada; coba simpan lagi dengan isian yang sama.");
    } finally {
      setPending(false);
    }
  };
  return (
    <form method="post" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }} className="crm-sec">
      <input type="hidden" name="profile_id" value={snapshot.profile_id} />
      <input type="hidden" name="expected_version" value={snapshot.version} />
      <input type="hidden" name="request_id" value={saveRequestId} />
      {message && <p role="alert" className="p2ban" style={{ color: "#b91c1c", background: "#fef2f2" }}>{message}</p>}
      <p>Status saat ini: <span className={`bge ${snapshot.is_active ? "g" : "r"}`}>{snapshot.is_active ? "Aktif" : "Nonaktif"}</span></p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label className="flab">Nama akun *
          <input className="fi" name="full_name" required maxLength={200} disabled={pending} value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        <label className="flab">Role *
          <select className="fi" name="role" required value={role} disabled={snapshot.self || pending} onChange={(event) => setRole(event.target.value)}>
            {!snapshot.editable_roles.includes(snapshot.role) && <option value={snapshot.role} disabled>{snapshot.role} (role saat ini)</option>}
            {snapshot.editable_roles.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>
      {snapshot.self && <><input type="hidden" name="role" value={snapshot.role} />{snapshot.branch_ids.map((id) => <input key={id} type="hidden" name="branch_ids" value={id} />)}</>}
      <p style={{ fontSize: 12, color: "var(--tm)" }}>Nama akun dipakai pada akun login. Identitas dan nama karyawan HRIS dikelola terpisah.</p>
      {snapshot.self && <p role="status">Untuk akun sendiri, hanya nama akun yang dapat diubah. Role dan penugasan cabang tetap.</p>}
      <fieldset style={{ border: 0, padding: 0, margin: "16px 0" }}>
        <legend className="flab" style={{ marginBottom: 8 }}>Penugasan cabang akun</legend>
        <p style={{ fontSize: 12, color: "var(--tm)" }}>Penugasan akun terpisah dari penempatan karyawan HRIS. Akses semua cabang mengikuti aturan Akses Grup.</p>
        {branches.some((branch) => branch.legacy) && <p role="status" style={{ fontSize: 12 }}>Cabang lama tetap dipilih. Lepaskan pilihan secara sengaja bila ingin menghapus penugasannya; pilihan baru hanya cabang aktif yang diizinkan.</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {branches.map((branch) => <label key={branch.id} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, border: ".5px solid var(--bd)", borderRadius: 6, padding: "6px 10px" }}>
            <input type="checkbox" name="branch_ids" value={branch.id} checked={branchIds.includes(branch.id)} disabled={snapshot.self || pending}
              onChange={(event) => setBranchIds((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))} />
            {branch.name}{!branch.is_active && " (Nonaktif/penugasan lama)"}
          </label>)}
          {!branches.length && <span style={{ fontSize: 12 }}>Tidak ada penugasan atau pilihan cabang yang tersedia.</span>}
        </div>
      </fieldset>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="submit" className="btn-acc" disabled={pending}>{pending ? "Menyimpan…" : "Simpan perubahan akun"}</button>
      </div>
    </form>
  );
}
