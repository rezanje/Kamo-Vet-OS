import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { tarikPajakMasa } from "@/lib/faktur-pajak-server";
import { formatNpwp, periksaKesiapan, ringkasMasa, type BarisPajak } from "@/lib/faktur-pajak";
import { labelBulan } from "@/lib/pertumbuhan";
import { tanggalIndo } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";

// Berkas Pajak per Masa (S10).
//
// Isinya daftar pajak keluaran & masukan satu bulan lengkap dengan identitas kedua
// pihak, plus unduhan CSV untuk staf pajak. Yang sengaja TIDAK dibuat: berkas impor
// Coretax/e-Faktur jadi — tata letaknya ditentukan DJP dan berubah-ubah, menebaknya
// berarti berkas yang ditolak saat pelaporan.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const masaSekarang = () => hariIniWIB().slice(0, 7);

// Didefinisikan di lingkup modul, bukan di dalam komponen halaman: komponen yang
// dibuat ulang tiap render membuat React membongkar-pasang seluruh isinya.
function TabelPajak({ judul, nomorSeksi, baris, kolomFakturPajak }: {
  judul: string; nomorSeksi: string; baris: BarisPajak[]; kolomFakturPajak: boolean;
}) {
  return (
    <div className="crm-sec" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>{nomorSeksi} · {judul} ({baris.length})</div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              <th style={{ width: 95 }}>Tanggal</th>
              <th style={{ width: 160 }}>No. dokumen</th>
              <th>Lawan transaksi</th>
              <th style={{ width: 170 }}>NPWP</th>
              {kolomFakturPajak && <th style={{ width: 170 }}>No. faktur pajak</th>}
              <th style={{ width: 140, textAlign: "right" }}>DPP</th>
              <th style={{ width: 130, textAlign: "right" }}>PPN</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((r) => (
              <tr key={`${r.nomor}-${r.tanggal}`}>
                <td style={{ fontSize: 10.5 }}>{tanggalIndo(r.tanggal)}</td>
                <td style={{ fontSize: 11, fontWeight: 600 }}>{r.nomor}</td>
                <td style={{ fontSize: 11 }}>{r.pihak}</td>
                <td style={{ fontSize: 10.5, color: r.npwp ? "var(--tm)" : "#b45309" }}>
                  {r.npwp ? formatNpwp(r.npwp) : "belum diisi"}
                </td>
                {kolomFakturPajak && (
                  <td style={{ fontSize: 10.5, color: r.noFakturPajak ? "var(--tm)" : "#b45309" }}>
                    {r.noFakturPajak || "belum diisi"}
                  </td>
                )}
                <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{r.dpp ? rp(r.dpp) : "—"}</td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.ppn)}</td>
              </tr>
            ))}
            {baris.length === 0 && (
              <TabelKosong kolom={kolomFakturPajak ? 7 : 6} pesan={`Tidak ada ${judul.toLowerCase()} di masa ini.`} />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function BerkasPajakPage({
  searchParams,
}: {
  searchParams: Promise<{ masa?: string }>;
}) {
  const sp = await searchParams;
  const masa = /^\d{4}-\d{2}$/.test(sp.masa ?? "") ? sp.masa! : masaSekarang();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN", "FINANCE"].includes(String(me.role))) redirect("/pajak");

  const { keluaran, masukan, perusahaan, modePkp } = await tarikPajakMasa(masa);
  const ringkas = ringkasMasa(masa, keluaran, masukan);
  const masalah = periksaKesiapan({
    npwpPerusahaan: perusahaan.npwp, namaPerusahaan: perusahaan.nama, keluaran, masukan,
  });

  return (
    <LaporanPage
      icon="ti-receipt-tax" title="BERKAS PAJAK PER MASA"
      desc="Daftar pajak keluaran & masukan satu bulan, siap dipindahkan ke berkas pelaporan."
      filter={
        <>
          <div style={{ minWidth: 170 }}>
            <label className="flab">Masa pajak</label>
            <input className="fi" type="month" name="masa" defaultValue={masa} />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
          <a href={`/pajak/faktur/unduh?masa=${masa}`} className="btn-acc"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i className="ti ti-download" /> Unduh berkas CSV
          </a>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Masa", nilai: labelBulan(masa) },
          { label: "DPP keluaran", nilai: rp(ringkas.keluaranDpp) },
          { label: "PPN keluaran", nilai: rp(ringkas.keluaranPpn), warna: "#15803d" },
          { label: "PPN masukan", nilai: `− ${rp(ringkas.masukanPpn)}`, warna: "#b45309" },
          {
            label: ringkas.netto >= 0 ? "PPN kurang bayar" : "PPN lebih bayar",
            nilai: rp(Math.abs(ringkas.netto)),
            warna: ringkas.netto >= 0 ? "#b91c1c" : "#15803d",
          },
        ]} />
      }
    >
      {!modePkp && (
        <div className="crm-sec" style={{ marginBottom: 12, fontSize: 11.5, color: "#b45309", lineHeight: 1.7 }}>
          <i className="ti ti-info-circle" /> <b>Mode PKP masih mati.</b> Selama belum dikukuhkan sebagai
          Pengusaha Kena Pajak, perusahaan tidak memungut PPN dan halaman ini memang kosong — itu benar,
          bukan data yang hilang. Nyalakan di{" "}
          <Link href="/pengaturan/pajak" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 700 }}>
            Pengaturan → Pajak
          </Link>{" "}
          setelah surat pengukuhannya terbit.
        </div>
      )}

      {masalah.length > 0 && (
        <div className="crm-sec" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8, color: "#b45309" }}>
            <i className="ti ti-alert-triangle" /> YANG MASIH KURANG SEBELUM BERKASNYA BISA DILAPORKAN
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "var(--tm)", lineHeight: 1.8 }}>
            {masalah.map((m) => <li key={m.hal}>{m.pesan}</li>)}
          </ul>
        </div>
      )}

      <TabelPajak nomorSeksi="01" judul="PAJAK KELUARAN" baris={keluaran} kolomFakturPajak={false} />
      <TabelPajak nomorSeksi="02" judul="PAJAK MASUKAN" baris={masukan} kolomFakturPajak />

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · IDENTITAS PERUSAHAAN DI BERKAS</div>
        <table className="tbl" style={{ minWidth: 420 }}>
          <tbody>
            <tr>
              <td style={{ fontSize: 11, width: 160 }}>Nama perusahaan</td>
              <td style={{ fontSize: 11.5, fontWeight: 700, color: perusahaan.nama ? "var(--sb)" : "#b45309" }}>
                {perusahaan.nama || "belum diisi"}
              </td>
            </tr>
            <tr>
              <td style={{ fontSize: 11 }}>NPWP</td>
              <td style={{ fontSize: 11.5, fontWeight: 700, color: perusahaan.npwp ? "var(--sb)" : "#b45309" }}>
                {perusahaan.npwp ? formatNpwp(perusahaan.npwp) : "belum diisi"}
              </td>
            </tr>
            <tr>
              <td style={{ fontSize: 11 }}>Alamat</td>
              <td style={{ fontSize: 11, color: perusahaan.alamat ? "var(--tm)" : "#b45309" }}>
                {perusahaan.alamat || "belum diisi"}
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 10, lineHeight: 1.7 }}>
          Diisi di{" "}
          <Link href="/pengaturan/pajak" style={{ color: "#2563eb", textDecoration: "none" }}>Pengaturan → Pajak</Link>.
          Data yang sama nanti dipakai kop dokumen cetak.<br />
          <b>Soal berkas Coretax / e-Faktur:</b> tata letak berkas impornya ditentukan DJP dan berubah
          dari waktu ke waktu. Yang disediakan di sini adalah SELURUH isian yang dibutuhkan dalam satu
          tabel — angkanya diambil dari jurnal, jadi persis sama dengan Rekap PPN dan Neraca. Staf pajak
          atau konsultan tinggal memindahkannya ke template resmi yang mereka pegang. Kalau nanti klien
          mengirimkan templatenya, berkas jadi bisa dibuatkan langsung dari data yang sama.
        </div>
      </div>
    </LaporanPage>
  );
}
