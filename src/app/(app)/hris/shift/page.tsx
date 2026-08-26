import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { jamRingkas } from "@/lib/shift-master";
import { simpanShift, toggleShift } from "./actions";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Shift = {
  id: string; nama: string; jam_masuk: string | null; jam_pulang: string | null;
  is_libur: boolean; warna: string; is_active: boolean; branches: Rel<{ name: string }>;
};

export default async function ShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: branches }] = await Promise.all([
    supabase
      .from("work_shifts")
      .select("id, nama, jam_masuk, jam_pulang, is_libur, warna, is_active, branches(name)")
      .order("is_libur").order("jam_masuk"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const shifts = (data ?? []) as unknown as Shift[];

  return (
    <MasterPage
      back="/hris" icon="ti-clock-hour-8" title="MASTER SHIFT"
      desc="Pola jam kerja yang nanti ditempel ke jadwal karyawan"
      error={error} success={success} successMsg="Shift tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah master shift."
    >
      {bolehKelola && (
        <form action={simpanShift} className="crm-sec" style={{ marginBottom: 14 }}>
          <div className="frow">
            <div>
              <label className="flab">Nama shift *</label>
              <input className="fi" name="nama" maxLength={40} placeholder="mis. Pagi" required />
            </div>
            <div>
              <label className="flab">Jam masuk</label>
              <input className="fi" name="jam_masuk" type="time" defaultValue="08:00" />
            </div>
            <div>
              <label className="flab">Jam pulang</label>
              <input className="fi" name="jam_pulang" type="time" defaultValue="17:00" />
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id" defaultValue="">
                <option value="">— Semua cabang —</option>
                {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Warna di papan jadwal</label>
              <input className="fi" name="warna" type="color" defaultValue="#2563eb" style={{ padding: 3, height: 34 }} />
            </div>
            <div>
              <label className="flab">Jenis</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, height: 34 }}>
                <input type="checkbox" name="is_libur" value="1" />
                Hari libur (tanpa jam kerja)
              </label>
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6 }}>
            Shift yang lewat tengah malam boleh: mis. masuk 21:00 pulang 05:00.
            Hari libur terjadwal tidak dihitung bolos saat penggajian.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan shift
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th>
                <th>Shift</th>
                <th style={{ width: 130 }}>Jam</th>
                <th style={{ width: 150 }}>Cabang</th>
                <th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 120 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={s.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                    <span style={{
                      display: "inline-block", width: 10, height: 10, borderRadius: 3,
                      background: s.warna, marginRight: 7, verticalAlign: -1,
                    }} />
                    {s.nama}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: "monospace" }}>{jamRingkas(s.jam_masuk, s.jam_pulang)}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{one(s.branches)?.name ?? "Semua cabang"}</td>
                  <td><span className={`bge ${s.is_active ? "g" : "x"}`}>{s.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <form action={toggleShift}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="aktif" value={s.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {s.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr><td colSpan={bolehKelola ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada shift. Buat minimal satu shift kerja dan satu shift libur.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
