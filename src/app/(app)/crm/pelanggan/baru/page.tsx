import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { simpanPelanggan } from "./actions";

export default async function TambahPelangganPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm/pelanggan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Tambah Pelanggan Baru</span>
      </div>

      {error && (
        <div
          className="p2ban"
          style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}
        >
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={simpanPelanggan}>
        <div className="grid2">
          {/* Section 01: Data Pribadi */}
          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <SecHeader num="01" title="DATA PRIBADI" desc="Informasi dasar pelanggan baru." />

            <div className="fg">
              <label className="flab">
                Nama Lengkap <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input className="fi" name="nama" placeholder="Andi Santoso" required />
            </div>

            <div className="fg">
              <label className="flab">
                No. HP <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input className="fi" name="phone" placeholder="081234567890" required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Nomor HP akan dipakai sebagai identitas unik pelanggan.
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Email</label>
                <input className="fi" name="email" type="email" placeholder="andi@email.com" />
              </div>
              <div>
                <label className="flab">Tgl Lahir</label>
                <input className="fi" name="dob" type="date" />
              </div>
            </div>

            <div className="fg">
              <label className="flab">Alamat</label>
              <input className="fi" name="alamat" placeholder="Jl. Merdeka No. 10, Jakarta" />
            </div>

            <div className="frow">
              <div>
                <label className="flab">Pekerjaan</label>
                <input className="fi" name="pekerjaan" placeholder="Wiraswasta" />
              </div>
              <div>
                <label className="flab">Sumber Info</label>
                <input className="fi" name="sumber_info" placeholder="Instagram, Teman, dll." />
              </div>
            </div>
          </div>

          {/* Section 02: Keanggotaan */}
          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <SecHeader num="02" title="KEANGGOTAAN" desc="Atur status keanggotaan dan kategori pelanggan." />

            <div className="fg">
              <label className="flab">Keanggotaan</label>
              <select className="fi" name="keanggotaan">
                <option value="Non Member">Non Member</option>
                <option value="Member">Member</option>
              </select>
            </div>

            <div className="fg">
              <label className="flab">Kategori / Tier</label>
              <select className="fi" name="tier">
                <option value="">— Tidak ada —</option>
                <option value="Bronze">Bronze</option>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
                <option value="Platinum">Platinum</option>
              </select>
            </div>

            <div className="fg">
              <label className="flab">Catatan</label>
              <textarea
                className="fi"
                name="catatan"
                placeholder="Catatan tambahan tentang pelanggan ini..."
                rows={5}
                style={{ resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Link href="/crm/pelanggan" className="btn-def">Batal</Link>
          <button type="submit" className="btn-acc">Simpan Pelanggan</button>
        </div>
      </form>
    </>
  );
}
