import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { registrasiPasien } from "./actions";

export default async function RegistrasiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches").select("id, code, name").order("name");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Registrasi Pasien Baru</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={registrasiPasien}>
        <div className="grid2">
          <div className="card">
            <div className="card-hd">
              <i className="ti ti-user" style={{ color: "var(--acc)" }} /> Pemilik hewan
            </div>
            <div className="fg">
              <label className="flab">
                Nomor HP <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input className="fi" name="phone" placeholder="081234567890" required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Kalau nomor sudah terdaftar, data pelanggan lama otomatis dipakai.
              </div>
            </div>
            <div className="frow">
              <div>
                <label className="flab">
                  Nama lengkap <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input className="fi" name="name" placeholder="Dian Pratiwi" required />
              </div>
              <div>
                <label className="flab">
                  Tgl lahir{" "}
                  <span style={{ color: "var(--acc)" }} title="Untuk WA birthday trigger">★WA</span>
                </label>
                <input className="fi" name="dob" type="date" />
              </div>
            </div>
            <div>
              <label className="flab">Alamat</label>
              <input className="fi" name="address" placeholder="Jl. Contoh No. 1, Bogor" />
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <i className="ti ti-paw" style={{ color: "#16a34a" }} /> Data hewan peliharaan
            </div>
            <div className="frow">
              <div>
                <label className="flab">
                  Nama hewan <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input className="fi" name="petName" placeholder="Max" required />
              </div>
              <div>
                <label className="flab">
                  Spesies <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <select className="fi" name="species" required>
                  <option>Anjing</option>
                  <option>Kucing</option>
                  <option>Kelinci</option>
                  <option>Burung</option>
                  <option>Lainnya</option>
                </select>
              </div>
            </div>
            <div className="frow">
              <div>
                <label className="flab">Ras</label>
                <input className="fi" name="breed" placeholder="Golden Retriever" />
              </div>
              <div>
                <label className="flab">Tgl lahir</label>
                <input className="fi" name="petDob" type="date" />
              </div>
            </div>
            <div className="frow">
              <div>
                <label className="flab">Jenis kelamin</label>
                <select className="fi" name="gender">
                  <option>Jantan</option>
                  <option>Betina</option>
                </select>
              </div>
              <div>
                <label className="flab">Berat badan (kg)</label>
                <input className="fi" name="weight" type="number" step="0.1" placeholder="5.2" />
              </div>
            </div>
            <div className="frow">
              <div>
                <label className="flab">
                  Cabang <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <select className="fi" name="branchId" required>
                  <option value="">Pilih cabang</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flab">Poli</label>
                <select className="fi" name="poli">
                  <option>Poli Umum</option>
                  <option>Poli Gigi</option>
                  <option>Poli Kulit</option>
                  <option>Vaksinasi</option>
                  <option>Grooming</option>
                </select>
              </div>
            </div>
            <div>
              <label className="flab">Keluhan / catatan kunjungan</label>
              <input className="fi" name="keluhan" placeholder="Batal, nafsu makan turun" />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Link href="/klinik" className="btn-def">Batal</Link>
          <button type="submit" className="btn-acc">Daftarkan pasien</button>
        </div>
      </form>
    </>
  );
}
