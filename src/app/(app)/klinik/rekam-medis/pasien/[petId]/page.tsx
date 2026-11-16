import Link from "next/link";
import { notFound } from "next/navigation";
import { ListLoadFailure } from "@/components/ListPagination";
import { adalahUuid, bacaMuatan, MAKS_MUATAN } from "@/lib/riwayat-pasien";
import { bacaRiwayatPasien, type RiwayatPasien } from "@/lib/riwayat-pasien-server";
import { RiwayatPasienHeader } from "./RiwayatPasienHeader";
import { RiwayatPasienView } from "./RiwayatPasienView";

/**
 * Riwayat pasien: semua kunjungan SATU hewan di satu halaman (terbaru dulu, bisa dibuka-tutup), supaya dokter
 * tidak membuka satu tab per kunjungan. Akses = daftar Rekam Medis (lihat riwayat-pasien-server.ts); halaman ini
 * tidak punya izin sendiri: prefix /klinik/rekam-medis sudah dijaga menu "Rekam medis".
 */
export default async function RiwayatPasienPage({
  params,
  searchParams,
}: {
  params: Promise<{ petId: string }>;
  searchParams: Promise<{ muat?: string }>;
}) {
  const { petId } = await params;
  const { muat } = await searchParams;
  if (!adalahUuid(petId)) notFound();
  const muatan = bacaMuatan(muat);

  let hasil: RiwayatPasien;
  try {
    hasil = await bacaRiwayatPasien(petId, muatan);
  } catch (error) {
    return (
      <>
        <KembaliKeDaftar />
        <ListLoadFailure error={error} label="Riwayat pasien" />
      </>
    );
  }
  if (hasil.status === "tidak-ada") notFound();

  const { profil, kunjungan, total, adaLagi } = hasil;
  return (
    <>
      <KembaliKeDaftar />
      <div style={{ marginBottom: 12 }}>
        <div className="pg-hd" style={{ marginBottom: 2 }}>RIWAYAT PASIEN</div>
        <div className="pg-sub">{profil.nama} · {profil.pemilik} · {total} kunjungan dengan rekam medis</div>
      </div>

      <RiwayatPasienHeader profil={profil} kunjungan={kunjungan} />

      <div className="crm-sec">
        <RiwayatPasienView kunjungan={kunjungan} />
        {adaLagi && (
          <div style={{ textAlign: "center", marginTop: 6 }}>
            {muatan < MAKS_MUATAN ? (
              <Link href={`/klinik/rekam-medis/pasien/${petId}?muat=${muatan + 1}`} scroll={false} className="btn-def" style={{ textDecoration: "none" }}>
                Muat lebih banyak ({kunjungan.length} dari {total})
              </Link>
            ) : (
              <span style={{ fontSize: 11, color: "var(--tm)" }}>Menampilkan {kunjungan.length} dari {total} kunjungan. Sisanya ada di daftar Rekam Medis.</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function KembaliKeDaftar() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <Link href="/klinik/rekam-medis" className="back-btn"><i className="ti ti-arrow-left" /> Rekam medis</Link>
      <span style={{ color: "var(--td)" }}>·</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>Riwayat pasien</span>
    </div>
  );
}
