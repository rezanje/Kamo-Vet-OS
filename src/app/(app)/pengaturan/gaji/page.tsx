import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { getAturanGaji, potonganTelat } from "@/lib/payroll-aturan";
import { simpanAturanGaji } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function AturanGajiPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const a = await getAturanGaji(supabase);
  const aktif = a.telat_nominal_per_blok > 0 || a.bolos_per_hari > 0 || a.lembur_per_jam > 0;

  // Contoh hidup pakai aturan yang tersimpan — biar kelihatan efeknya sebelum gajian.
  const contoh = [1, 5, 6, 30, 120].map((m) => ({ menit: m, potong: potonganTelat(m, a) }));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Aturan Gaji</span>
        <span className={`bge ${aktif ? "g" : "x"}`}>{aktif ? "Aturan aktif" : "Belum diatur"}</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Aturan gaji tersimpan. Berlaku saat penggajian dihitung.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={simpanAturanGaji}>
        <div className="crm-sec">
          <SecHeader
            num="01" title="POTONGAN TELAT"
            desc="Dihitung berblok dari jam shift karyawan hari itu. Blok yang belum penuh dihitung penuh."
          />
          <div className="frow">
            <div>
              <label className="flab">Potongan mulai dari menit ke-</label>
              <input className="fi" name="telat_mulai_menit" type="number" min={0} step={1} defaultValue={a.telat_mulai_menit} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Telat di bawah angka ini tidak dipotong.</div>
            </div>
            <div>
              <label className="flab">Tiap berapa menit</label>
              <input className="fi" name="telat_blok_menit" type="number" min={1} step={1} defaultValue={a.telat_blok_menit} />
            </div>
            <div>
              <label className="flab">Potongan per blok</label>
              <input className="fi" name="telat_nominal_per_blok" type="number" min={0} step="any" defaultValue={a.telat_nominal_per_blok} />
            </div>
            <div>
              <label className="flab">Batas atas per hari</label>
              <input className="fi" name="telat_maks" type="number" min={0} step="any" defaultValue={a.telat_maks} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>0 = tanpa batas atas.</div>
            </div>
          </div>

          <div style={{ marginTop: 12, background: "var(--sf1)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, marginBottom: 6 }}>Contoh dengan aturan tersimpan:</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
              {contoh.map((c) => (
                <span key={c.menit}>
                  telat {c.menit} mnt → <b style={{ color: c.potong > 0 ? "#b91c1c" : "var(--td)" }}>{rp(c.potong)}</b>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="crm-sec">
          <SecHeader num="02" title="BOLOS & LEMBUR" desc="Bolos = hari kerja terjadwal tanpa absen dan tanpa cuti disetujui." />
          <div className="frow">
            <div>
              <label className="flab">Potongan bolos per hari</label>
              <input className="fi" name="bolos_per_hari" type="number" min={0} step="any" defaultValue={a.bolos_per_hari} />
            </div>
            <div>
              <label className="flab">Upah lembur per jam</label>
              <input className="fi" name="lembur_per_jam" type="number" min={0} step="any" defaultValue={a.lembur_per_jam} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Dipakai untuk lembur yang sudah disetujui.</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
              Simpan aturan
            </SubmitButton>
          </div>
        </div>
      </form>

      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 10, maxWidth: 720 }}>
        Selama semua nominal masih 0, penggajian tidak memotong dan tidak menambah apa pun —
        hasilnya sama seperti sebelum fitur ini ada. Toleransi telat di pengaturan jam kerja
        hanya dipakai untuk penandaan di laporan absensi, bukan untuk potongan.
      </div>
    </>
  );
}
