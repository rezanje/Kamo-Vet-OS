import Link from "next/link";
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
  is_libur: boolean; warna: string; is_active: boolean; branch_id: string | null; branches: Rel<{ name: string }>;
};

export default async function ShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: branches }] = await Promise.all([
    supabase
      .from("work_shifts")
      .select("id, nama, jam_masuk, jam_pulang, is_libur, warna, is_active, branch_id, branches(name)")
      .order("is_libur").order("jam_masuk"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const shifts = (data ?? []) as unknown as Shift[];
  // C1: ?edit=<id> membuka form dalam mode ubah (form mengirim id → server action update).
  const diubah = edit ? shifts.find((s) => s.id === edit) ?? null : null;

  return (
    <MasterPage
      back="/hris" icon="ti-clock-hour-8" title="MASTER SHIFT"
      desc="Pola jam kerja yang nanti ditempel ke jadwal karyawan"
      error={error} success={success} successMsg={success === "ubah" ? "Perubahan shift tersimpan." : "Shift tersimpan."}
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah master shift."
    >
      {bolehKelola && (
        <form action={simpanShift} className="crm-sec" style={{ marginBottom: 14 }} key={diubah?.id ?? "baru"}>
          {diubah && (
            <>
              <input type="hidden" name="id" value={diubah.id} />
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>
                <i className="ti ti-pencil" /> Ubah shift &quot;{diubah.nama}&quot;
              </div>
            </>
          )}
          <div className="frow">
            <div>
              <label className="flab">Nama shift *</label>
              <input className="fi" name="nama" maxLength={40} placeholder="mis. Pagi" required defaultValue={diubah?.nama ?? ""} />
            </div>
            <div>
              <label className="flab">Jam masuk</label>
              <input className="fi" name="jam_masuk" type="time" defaultValue={diubah ? diubah.jam_masuk?.slice(0, 5) ?? "" : "08:00"} />
            </div>
            <div>
              <label className="flab">Jam pulang</label>
              <input className="fi" name="jam_pulang" type="time" defaultValue={diubah ? diubah.jam_pulang?.slice(0, 5) ?? "" : "17:00"} />
            </div>
          </div>
          <div className="frow" style={{ marginTop: 10 }}>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id" defaultValue={diubah?.branch_id ?? ""}>
                <option value="">— Semua cabang —</option>
                {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Warna di papan jadwal</label>
              <input className="fi" name="warna" type="color" defaultValue={diubah?.warna ?? "#2563eb"} style={{ padding: 3, height: 34 }} />
            </div>
            <div>
              <label className="flab">Jenis</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, height: 34 }}>
                <input type="checkbox" name="is_libur" value="1" defaultChecked={diubah?.is_libur ?? false} />
                Hari libur (tanpa jam kerja)
              </label>
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6 }}>
            Shift yang lewat tengah malam boleh: mis. masuk 21:00 pulang 05:00.
            Hari libur terjadwal tidak dihitung bolos saat penggajian.
            {diubah && <> <b>Mengubah jam shift ikut mengubah hitungan telat semua jadwal yang memakai shift ini, termasuk tanggal lalu yang gajinya belum disahkan.</b></>}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            {diubah && <Link href="/hris/shift" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
            <SubmitButton className="btn-acc" icon={diubah ? "ti-device-floppy" : "ti-plus"} pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              {diubah ? "Simpan perubahan" : "Simpan shift"}
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
                {bolehKelola && <th style={{ width: 170 }}>Aksi</th>}
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
                    <td style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Link href={`/hris/shift?edit=${s.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>
                        <i className="ti ti-pencil" /> Ubah
                      </Link>
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
