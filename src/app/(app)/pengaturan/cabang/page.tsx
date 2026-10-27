import { NumberInput } from "@/components/NumberInput";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { groomingDoctorRequired, isGroomingOutlet } from "@/lib/grooming-requirements";
import { simpanAturanGroomingCabang, simpanLokasiCabang } from "./actions";

// REAL data. branches = readable by all authenticated; warehouses = RLS-filtered
// (STAFF sees only assigned-branch warehouses, OWNER/ADMIN see all).
// Cabang baru dibuat OWNER di Perusahaan → Cabang (U11). Yang bisa diubah dari sini
// titik lokasi absen dan aturan grooming.
export default async function CabangPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: branches }, { data: warehouses }, { data: groomingRules, error: groomingRulesError }] = await Promise.all([
    supabase.from("branches").select("id, code, name, type, is_active, lat, lng, radius_m").order("name"),
    supabase.from("warehouses").select("code, name, type, branches(name)").order("code"),
    supabase.from("branch_grooming_rules").select("branch_id,doctor_required"),
  ]);

  const cabang = (branches ?? []) as {
    id: string; code: string; name: string; type: string; is_active: boolean;
    lat: number | null; lng: number | null; radius_m: number;
  }[];
  const berlokasi = cabang.filter((b) => b.lat !== null && b.lng !== null).length;
  const groomingByBranch = new Map((groomingRules ?? []).map(rule => [rule.branch_id, rule.doctor_required]));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Cabang &amp; Gudang</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "grooming" ? "Aturan grooming cabang tersimpan." : "Lokasi cabang tersimpan."}
        </div>
      )}

      <div className="pg-sub" style={{ marginBottom: 10 }}>
        {cabang.length} cabang · {warehouses?.length ?? 0} gudang dapat diakses ·
        {" "}{berlokasi} cabang sudah punya titik absen
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01" title="LOKASI ABSEN CABANG"
          desc="Absen staf hanya diterima dari dalam radius ini. Titik dikosongkan = pengecekan lokasi mati untuk cabang itu."
        />
        {/* Satu form utuh per cabang, bukan tabel: input yang ditaruh di luar <form>
            lalu disambung lewat atribut form= tidak ikut terkirim ke server action. */}
        <div>
          {cabang.map((b) => (
            <form
              key={b.id} action={simpanLokasiCabang}
              style={{
                display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap",
                padding: "8px 0", borderBottom: ".5px solid var(--bd)",
              }}
            >
              <input type="hidden" name="id" value={b.id} />
              <div style={{ minWidth: 210, flex: "1 1 210px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600 }}>{b.name}</div>
                <div style={{ fontSize: 9.5, color: "var(--td)", fontFamily: "monospace" }}>{b.code}</div>
              </div>
              <div>
                <label className="flab">Lintang (lat)</label>
                <NumberInput className="fi" name="lat" type="number" step="any" defaultValue={b.lat ?? ""}
                  placeholder="-6.5971" disabled={!bolehKelola}
                  style={{ fontSize: 10.5, padding: "4px 6px", height: 28, width: 120 }} />
              </div>
              <div>
                <label className="flab">Bujur (lng)</label>
                <NumberInput className="fi" name="lng" type="number" step="any" defaultValue={b.lng ?? ""}
                  placeholder="106.7991" disabled={!bolehKelola}
                  style={{ fontSize: 10.5, padding: "4px 6px", height: 28, width: 120 }} />
              </div>
              <div>
                <label className="flab">Radius (m)</label>
                {/* step harus 1: dengan step=10 & min=1, angka bulat seperti 300 dianggap tidak valid
                    dan browser MEMBLOKIR submit tanpa pesan apa pun. */}
                <NumberInput className="fi" name="radius_m" type="number" min={1} step={1} defaultValue={b.radius_m}
                  disabled={!bolehKelola}
                  style={{ fontSize: 10.5, padding: "4px 6px", height: 28, width: 90 }} />
              </div>
              <div style={{ paddingBottom: 4 }}>
                <span className={`bge ${b.lat !== null ? "g" : "x"}`}>
                  {b.lat !== null ? "Terkunci lokasi" : "Bebas"}
                </span>
              </div>
              {bolehKelola && (
                <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                  Simpan
                </button>
              )}
            </form>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "var(--td)", marginTop: 8 }}>
          Cara ambil titik: buka Google Maps di lokasi cabang, tekan lama di titiknya, angka
          yang muncul (mis. <code>-6.5971, 106.7991</code>) disalin ke kolom lintang &amp; bujur.
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="PELAKSANA GROOMING PER CABANG" desc="Groomer selalu wajib. Cabang berklinik juga memerlukan dokter, kecuali diatur berbeda di sini." />
        {groomingRulesError ? <p role="alert">Aturan grooming belum dapat dimuat. Muat ulang sebelum menyimpan.</p> : cabang.filter(branch => isGroomingOutlet(branch.type)).map(branch => (
          <form key={branch.id} action={simpanAturanGroomingCabang} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", borderBottom: "1px solid var(--bd)", padding: "10px 0" }}>
            <input type="hidden" name="id" value={branch.id} />
            <div style={{ minWidth: 180, flex: "1 1 180px" }}><strong>{branch.name}</strong><div style={{ color: "var(--tm)" }}>{branch.code} · {branch.type}</div></div>
            <label className="flab">Pelaksana wajib untuk Grooming
              <select className="fi" name="doctor_required" defaultValue={groomingDoctorRequired(branch.type, groomingByBranch.get(branch.id)) ? "1" : "0"} disabled={!bolehKelola}>
                <option value="1">Dokter dan groomer</option>
                <option value="0">Groomer saja</option>
              </select>
            </label>
            {bolehKelola && <button type="submit" className="btn-def">Simpan</button>}
          </form>
        ))}
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-hd">
            <i className="ti ti-building-store" style={{ color: "var(--acc)" }} /> Cabang
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Kode</th><th>Nama</th><th>Tipe</th><th>Status</th></tr>
            </thead>
            <tbody>
              {cabang.map((b) => (
                <tr key={b.code}>
                  <td style={{ fontFamily: "monospace", fontSize: 10 }}>{b.code}</td>
                  <td>{b.name}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{b.type}</td>
                  <td>
                    <span className={`bge ${b.is_active ? "g" : "x"}`}>
                      {b.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-hd">
            <i className="ti ti-stack" style={{ color: "#16a34a" }} /> Gudang
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Kode</th><th>Nama</th><th>Cabang</th><th>Tipe</th></tr>
            </thead>
            <tbody>
              {warehouses?.map((w) => {
                const branch = (Array.isArray(w.branches) ? w.branches[0] : w.branches) as { name: string } | undefined;
                return (
                  <tr key={w.code}>
                    <td style={{ fontFamily: "monospace", fontSize: 10 }}>{w.code}</td>
                    <td>{w.name}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{branch?.name ?? "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{w.type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
