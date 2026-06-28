"use client";

import Link from "next/link";

// ponytail: static prototype form. Wires to customers/pets insert when the
// Smart Clinic module is built (tables already exist + RLS ready).
export default function RegistrasiPage() {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Registrasi Pasien Baru</span>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-hd">
            <i className="ti ti-user" style={{ color: "var(--acc)" }} /> Pemilik hewan
          </div>
          <div className="fg">
            <label className="flab">
              Nomor HP <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <div style={{ display: "flex", gap: 5 }}>
              <input className="fi" placeholder="081234567890" style={{ flex: 1 }} />
              <button className="btn-acc" style={{ padding: "6px 10px", fontSize: 11 }}>
                Cari
              </button>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">
                Nama lengkap <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input className="fi" placeholder="Dian Pratiwi" />
            </div>
            <div>
              <label className="flab">
                Tgl lahir <span style={{ color: "#dc2626" }}>*</span>{" "}
                <span style={{ color: "var(--acc)" }} title="Wajib — untuk WA birthday trigger">
                  ★WA
                </span>
              </label>
              <input className="fi" type="date" />
            </div>
          </div>
          <div className="fg">
            <label className="flab">Alamat</label>
            <input className="fi" placeholder="Jl. Contoh No. 1, Bogor" />
          </div>
          <div>
            <label className="flab">WhatsApp (untuk notifikasi otomatis)</label>
            <input className="fi" placeholder="Sama dengan HP" />
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
              <input className="fi" placeholder="Max" />
            </div>
            <div>
              <label className="flab">
                Spesies <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select className="fi">
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
              <input className="fi" placeholder="Golden Retriever" />
            </div>
            <div>
              <label className="flab">
                Tgl lahir <span style={{ color: "#dc2626" }}>*</span>{" "}
                <span style={{ color: "var(--acc)" }}>★WA</span>
              </label>
              <input className="fi" type="date" />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Jenis kelamin</label>
              <select className="fi">
                <option>Jantan</option>
                <option>Betina</option>
              </select>
            </div>
            <div>
              <label className="flab">Berat badan (kg)</label>
              <input className="fi" type="number" placeholder="5.2" />
            </div>
          </div>
          <div>
            <label className="flab">Tipe kunjungan</label>
            <select className="fi">
              <option>Konsultasi</option>
              <option>Vaksinasi</option>
              <option>Grooming</option>
              <option>Rawat Inap</option>
              <option>Operasi / Bedah</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Link href="/klinik" className="btn-def">
          Batal
        </Link>
        <button
          className="btn-acc"
          onClick={() => alert("Pasien berhasil didaftarkan!\nNomor antrian: A-047")}
        >
          Daftarkan pasien
        </button>
      </div>
    </>
  );
}
