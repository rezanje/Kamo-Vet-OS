import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { imporKaryawanExcel } from "./actions";

export default async function ImporKaryawanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const bolehKelola = await bolehKelolaMaster();
  const supabase = await createClient();
  const { data: branches } = bolehKelola
    ? await supabase.from("branches").select("id, name").eq("is_active", true).order("name")
    : { data: [] };

  return (
    <>
      <Link href="/hris/karyawan" className="back-btn">
        <i className="ti ti-arrow-left" /> Kembali ke Karyawan
      </Link>
      <div className="crm-sec" style={{ marginTop: 12 }}>
        <SecHeader num="01" title="UNGGAH DATA KARYAWAN" desc="Masukkan banyak karyawan dari Format Data Karyawan.xlsx." />
        {error && <div className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>{error}</div>}
        {success && <div className="p2ban" style={{ background: "#e8f5ee", color: "#15803d" }}>{success}</div>}
        {!bolehKelola ? (
          <p>Hanya pemilik dan admin yang boleh mengunggah data karyawan.</p>
        ) : (
          <form action={imporKaryawanExcel}>
            <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
              <div>
                <label className="flab" htmlFor="file-karyawan">File Excel (.xlsx) *</label>
                <input id="file-karyawan" className="fi" type="file" name="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
              </div>
              <div>
                <label className="flab" htmlFor="cabang-karyawan">Cabang untuk seluruh karyawan di file ini</label>
                <select id="cabang-karyawan" className="fi" name="branch_id" defaultValue="">
                  <option value="">Belum ditetapkan</option>
                  {(branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 12, color: "var(--tm)", lineHeight: 1.7 }}>
                Maksimal 500 karyawan / 900 KB per file. Semua baris diperiksa sebelum disimpan.
                ID yang sudah ada dilewati tanpa mengubah data lama. Bila file berisi beberapa cabang,
                pisahkan per cabang atau pilih “Belum ditetapkan”.
                Kolom akun login hanya disimpan sebagai referensi; unggah ini tidak membuat akun.
                Gaji pokok tidak ada dalam format ini, jadi perlu diisi sebelum penggajian.
              </div>
              <SubmitButton className="btn-acc" icon="ti-upload" pendingText="Memeriksa dan mengunggah…">
                Unggah Karyawan
              </SubmitButton>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
