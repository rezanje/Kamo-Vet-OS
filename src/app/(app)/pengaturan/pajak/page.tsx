import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { simpanPajak } from "./actions";

export default async function PajakPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("company_settings").select("mode_pkp, ppn_rate, nama_perusahaan, npwp, alamat").eq("id", true).maybeSingle();
  const modePkp = !!s?.mode_pkp;
  const rate = Number(s?.ppn_rate) || 11;
  const nama = (s?.nama_perusahaan as string | null) ?? "";
  const npwp = (s?.npwp as string | null) ?? "";
  const alamat = (s?.alamat as string | null) ?? "";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pajak (Mode PKP)</span>
        <span className={`bge ${modePkp ? "g" : "x"}`}>{modePkp ? `PKP AKTIF · PPN ${rate}%` : "Non-PKP"}</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={simpanPajak}>
        <div className="crm-sec" style={{ maxWidth: 560 }}>
          <SecHeader
            num="01"
            title="MODE PKP"
            desc="Aktifkan HANYA setelah perusahaan resmi dikukuhkan sebagai PKP. Berlaku ke transaksi baru; data lama tidak diubah."
          />
          <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, cursor: "pointer" }}>
            <input type="checkbox" name="mode_pkp" defaultChecked={modePkp} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Perusahaan berstatus PKP — pungut & pisahkan PPN</span>
          </label>
          <div className="fg" style={{ maxWidth: 160 }}>
            <label className="flab">Tarif PPN (%)</label>
            <input className="fi" type="number" name="ppn_rate" defaultValue={rate} min={1} max={50} step="any" />
          </div>
          <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 10, lineHeight: 1.6 }}>
            Saat AKTIF: harga POS dianggap sudah termasuk PPN (dipisah di pembukuan), tagihan klinik
            ditambah PPN di atas DPP, faktur pembelian memisahkan PPN Masukan. Rekap bulanan ada di{" "}
            <Link href="/keuangan/ppn" style={{ color: "var(--ac)" }}>Keuangan → Rekap PPN</Link>.
          </div>
        </div>

        <div className="crm-sec" style={{ maxWidth: 560 }}>
          <SecHeader
            num="02"
            title="IDENTITAS PERUSAHAAN"
            desc="Dipakai berkas pajak, dan nanti juga kop dokumen cetak. Boleh dikosongkan dulu."
          />
          <div className="fg">
            <label className="flab">Nama perusahaan</label>
            <input className="fi" name="nama_perusahaan" defaultValue={nama} placeholder="PT Kamo Group" maxLength={120} />
          </div>
          <div className="fg">
            <label className="flab">NPWP</label>
            <input className="fi" name="npwp" defaultValue={npwp} placeholder="01.234.567.8-901.000" maxLength={30} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              15 digit (format lama) atau 16 digit. Salah ketik di sini membuat seluruh berkas pajak
              ditolak, dan itu baru ketahuan saat pelaporan — jadi angkanya diperiksa saat disimpan.
            </div>
          </div>
          <div className="fg">
            <label className="flab">Alamat</label>
            <textarea className="fi" name="alamat" defaultValue={alamat} rows={2} maxLength={500} />
          </div>
          <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 4, lineHeight: 1.6 }}>
            Daftar pajak keluaran & masukan per bulan beserta unduhan berkasnya ada di{" "}
            <Link href="/pajak/faktur" style={{ color: "var(--ac)" }}>Pajak → Berkas Pajak per Masa</Link>.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="submit" className="btn-acc"><i className="ti ti-device-floppy" /> Simpan</button>
          </div>
        </div>
      </form>
    </>
  );
}
