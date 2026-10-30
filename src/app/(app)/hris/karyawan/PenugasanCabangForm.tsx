"use client";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { EmployeePicker } from "@/components/EmployeePicker";
import { simpanPenugasanCabang } from "./actions";

type Employee = { id: string; nama: string; jabatan: string | null; branch_id: string | null; branchName?: string | null };
export function PenugasanCabangForm({ employees, branches, today }: {
  employees: Employee[]; branches: { id: string; name: string }[]; today: string;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // Hasil simpan tampil di halaman ini juga — tidak lagi pindah ke daftar karyawan
  // yang harus merender ulang seluruh direktori hanya untuk menampilkan satu pesan.
  const [state, simpan] = useActionState(simpanPenugasanCabang, null);
  // Centang dibersihkan saat render berikutnya setelah simpan berhasil — tanpa
  // efek, supaya tidak memicu render berantai.
  const [terakhir, setTerakhir] = useState(state);
  if (state !== terakhir) { setTerakhir(state); if (state?.ok) setSelected([]); }
  const employee = employees.find(row => row.id === employeeId);
  const filtered = branches.filter(branch => branch.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <form action={simpan}>
    <input type="hidden" name="role" value="SECONDARY" />
    {selected.map(id => <input key={id} type="hidden" name="branch_ids" value={id} />)}
    {state && <div role={state.ok ? "status" : "alert"} className="p2ban"
      style={state.ok
        ? { background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }
        : { background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
      <i className={`ti ${state.ok ? "ti-circle-check" : "ti-alert-circle"}`} /> {state.pesan}
    </div>}
    <div className="grid2">
      <div>
        <label className="flab" htmlFor="assignment-employee">Karyawan *</label>
        <EmployeePicker inputId="assignment-employee" name="employee_id" required ariaLabel="Karyawan"
          placeholder="Ketik nama karyawan aktif, jabatan, atau cabang…"
          employees={employees} value={employeeId} onChange={id => { setEmployeeId(id); setSelected([]); }} />
      </div>
      <div>
        <label className="flab" htmlFor="assignment-date">Mulai berlaku *</label>
        <input id="assignment-date" className="fi" name="effective_date" type="date" defaultValue={today} required />
      </div>
    </div>
    <fieldset style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 12, marginTop: 12 }} disabled={!employeeId}>
      <legend style={{ fontSize: 12, fontWeight: 700 }}>Cabang tambahan *</legend>
      <label className="flab" htmlFor="assignment-search">Cari cabang</label>
      <input id="assignment-search" className="fi" placeholder="Cari nama cabang..." value={search} onChange={event => setSearch(event.target.value)} />
      <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 10, display: "grid", gap: 8 }}>
        {filtered.map(branch => {
          const primary = branch.id === employee?.branch_id;
          return <label key={branch.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: primary ? .6 : 1 }}>
            <input type="checkbox" aria-label={branch.name} checked={selected.includes(branch.id)} disabled={primary || (!selected.includes(branch.id) && selected.length >= 50)}
              onChange={event => setSelected(ids => event.target.checked ? [...ids, branch.id] : ids.filter(id => id !== branch.id))} />
            {branch.name} {primary && <span style={{ color: "var(--tm)" }}>· Cabang utama</span>}
          </label>;
        })}
        {!filtered.length && <span style={{ fontSize: 12, color: "var(--tm)" }}>Tidak ada cabang yang cocok.</span>}
      </div>
    </fieldset>
    <div aria-live="polite" style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>
      {selected.length} cabang dipilih{selected.length ? `: ${branches.filter(branch => selected.includes(branch.id)).map(branch => branch.name).join(", ")}` : ""}. Penugasan cabang yang sudah ada tetap tersimpan. Cabang yang pernah diakhiri akan dibuka kembali dengan tanggal mulai baru.
    </div>
    <div style={{ marginTop: 12 }}><SubmitButton className="btn-acc" icon="ti-git-branch" pendingText="Menyimpan penugasan…" disabled={!employeeId || selected.length === 0}>Simpan Penugasan</SubmitButton></div>
  </form>;
}
