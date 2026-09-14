import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { simpanAlatMedis, simpanMaintenance } from "./actions";

type Equipment = { id: string; branch_id: string; name: string; category: string | null; serial_number: string | null; location: string | null; next_maintenance_date: string | null; status: string; branches: { name: string } | { name: string }[] | null };
type Log = { id: string; equipment_id: string; maintenance_date: string; maintenance_type: string; technician: string | null; vendor: string | null; cost: number; result: string | null };
const one = <T,>(v: T | T[] | null): T | null => Array.isArray(v) ? v[0] ?? null : v;
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const bolehKelola = await bolehKelolaMaster();
  const [{ data: branches }, { data: equipmentData }, { data: logData }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).in("type", ["KLINIK", "BOTH"]).order("name"),
    supabase.from("medical_equipment").select("id, branch_id, name, category, serial_number, location, next_maintenance_date, status, branches(name)").order("next_maintenance_date"),
    supabase.from("medical_equipment_maintenance").select("id, equipment_id, maintenance_date, maintenance_type, technician, vendor, cost, result").order("maintenance_date", { ascending: false }).limit(100),
  ]);
  const equipment = (equipmentData ?? []) as unknown as Equipment[];
  const logs = (logData ?? []) as Log[];
  const equipmentName = new Map(equipment.map((e) => [e.id, e.name]));
  const today = hariIniWIB();
  const jatuhTempo = equipment.filter((e) => e.next_maintenance_date && e.next_maintenance_date <= today && e.status !== "Pensiun").length;

  return <>
    <div style={{ marginBottom: 4 }}><Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link></div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}><div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-tool" style={{ fontSize: 22, color: "#2563eb" }} /></div><div><div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>MAINTENANCE ALAT MEDIS</div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>{equipment.length} alat terdaftar · {jatuhTempo} perlu diperiksa</div></div></div>
    {sp.error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {sp.error}</div>}
    {sp.success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> {sp.success === "equipment" ? "Alat medis tersimpan." : "Maintenance tersimpan dan jadwal berikutnya diperbarui."}</div>}

    {bolehKelola && <div className="crm-sec"><div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>DAFTAR ALAT MEDIS</div><form action={simpanAlatMedis}><div className="grid2">
      <div><label className="flab">Nama alat *</label><input className="fi" name="name" required placeholder="mis. USG, monitor pasien" /></div>
      <div><label className="flab">Cabang *</label><select className="fi" name="branch_id" required><option value="">Pilih cabang</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
      <div><label className="flab">Jenis alat</label><input className="fi" name="category" placeholder="mis. Diagnostik, Operasi" /></div>
      <div><label className="flab">Nomor seri</label><input className="fi" name="serial_number" /></div>
      <div><label className="flab">Lokasi</label><input className="fi" name="location" placeholder="Ruang tindakan" /></div>
      <div><label className="flab">Interval pemeriksaan (hari)</label><input className="fi" name="maintenance_interval_days" type="number" min={1} defaultValue={180} /></div>
      <div><label className="flab">Maintenance berikutnya</label><input className="fi" name="next_maintenance_date" type="date" /></div>
      <div><label className="flab">Status</label><select className="fi" name="status" defaultValue="Aktif"><option>Aktif</option><option>Perbaikan</option><option>Pensiun</option></select></div>
    </div><div style={{ marginTop: 12 }}><button type="submit" className="btn-acc"><i className="ti ti-plus" /> Simpan alat</button></div></form></div>}

    <div className="crm-sec"><div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>STATUS ALAT</div><div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 760 }}><thead><tr><th>Alat</th><th>Cabang</th><th>Nomor seri</th><th>Lokasi</th><th>Jadwal berikutnya</th><th>Status</th></tr></thead><tbody>{equipment.map((e) => { const due = Boolean(e.next_maintenance_date && e.next_maintenance_date <= today); return (<tr key={e.id}><td style={{ fontWeight: 600, fontSize: 11.5 }}>{e.name}<div style={{ fontSize: 9.5, color: "var(--tm)" }}>{e.category ?? "—"}</div></td><td style={{ fontSize: 11 }}>{one(e.branches)?.name ?? "—"}</td><td style={{ fontSize: 10.5 }}>{e.serial_number ?? "—"}</td><td style={{ fontSize: 10.5 }}>{e.location ?? "—"}</td><td style={{ fontSize: 10.5, color: due ? "#b91c1c" : "var(--tx)", fontWeight: due ? 700 : 400 }}>{e.next_maintenance_date ?? "Belum dijadwalkan"}{due && <div style={{ fontSize: 9 }}>perlu diperiksa</div>}</td><td><span className={`bge ${e.status === "Aktif" ? "g" : e.status === "Perbaikan" ? "r" : "x"}`}>{e.status}</span></td></tr>); })}{equipment.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: 18, fontSize: 11 }}>Belum ada alat medis.</td></tr>}</tbody></table></div></div>

    {bolehKelola && equipment.length > 0 && <div className="crm-sec"><div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>CATAT MAINTENANCE</div><form action={simpanMaintenance}><div className="grid2"><div><label className="flab">Alat *</label><select className="fi" name="equipment_id" required><option value="">Pilih alat</option>{equipment.map((e) => <option key={e.id} value={e.id}>{e.name} · {one(e.branches)?.name ?? "—"}</option>)}</select></div><div><label className="flab">Tanggal *</label><input className="fi" name="maintenance_date" type="date" required /></div><div><label className="flab">Jenis pemeriksaan *</label><input className="fi" name="maintenance_type" required placeholder="Kalibrasi, servis, inspeksi" /></div><div><label className="flab">Jadwal berikutnya</label><input className="fi" name="next_due_date" type="date" /></div><div><label className="flab">Teknisi / vendor</label><input className="fi" name="technician" /></div><div><label className="flab">Biaya</label><input className="fi" name="cost" type="number" min={0} step={1000} defaultValue={0} /></div><div><label className="flab">Hasil / catatan</label><input className="fi" name="result" placeholder="Normal, perlu ganti komponen" /></div></div><div style={{ marginTop: 12 }}><SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">Simpan maintenance</SubmitButton></div></form></div>}

    <div className="crm-sec" style={{ marginBottom: 0 }}><div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>RIWAYAT MAINTENANCE</div><div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 760 }}><thead><tr><th>Tanggal</th><th>Alat</th><th>Jenis</th><th>Teknisi/vendor</th><th>Biaya</th><th>Hasil</th></tr></thead><tbody>{logs.map((l) => <tr key={l.id}><td style={{ fontSize: 10.5 }}>{l.maintenance_date}</td><td style={{ fontSize: 11, fontWeight: 600 }}>{equipmentName.get(l.equipment_id) ?? "—"}</td><td style={{ fontSize: 11 }}>{l.maintenance_type}</td><td style={{ fontSize: 10.5 }}>{l.technician ?? l.vendor ?? "—"}</td><td style={{ fontSize: 10.5, textAlign: "right" }}>{rp(Number(l.cost))}</td><td style={{ fontSize: 10.5 }}>{l.result ?? "—"}</td></tr>)}{logs.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: 18, fontSize: 11 }}>Belum ada riwayat maintenance.</td></tr>}</tbody></table></div></div>
  </>;
}
