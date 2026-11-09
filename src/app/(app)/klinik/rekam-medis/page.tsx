import { ListLoadError } from "@/lib/checked-list";
import { infoHalaman } from "@/lib/pagination";
import { ListPagination, ListLoadFailure } from "@/components/ListPagination";
import Link from "next/link";
import { createClientLintasCabang } from "@/lib/supabase/server";
import {
  bacaHasilHalamanRekamMedis, HALAMAN_REKAM_MEDIS, LABEL_RIWAYAT_IMPOR, MAKS_CARI_REKAM_MEDIS, PESAN_CARI_TERLALU_PANJANG,
  type BarisDaftarRekamMedis, type HalamanRekamMedis,
} from "@/lib/daftar-rekam-medis";
import { isPlaceholderOwnerName } from "@/lib/impor-rekam-medis";
import { hasActiveInpatient, statusPasienRekamMedis, type CatatanStatusRawatInap } from "@/lib/status-pasien-rekam-medis";
import { BukaRekamMedisLink } from "./BukaRekamMedisLink";

type Rel<T> = T | T[] | null;

function one<T>(value: Rel<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type RekamRow = BarisDaftarRekamMedis & {
  id: string;
  date: string;
  petId: string | null;
  species: string | null;
  breed: string | null;
  doctor: string | null;
  branch: string | null;
  note: string | null;
  diagnosis: string | null;
  isImported: boolean;
  activeInpatient: boolean;
  patientStatus: ReturnType<typeof statusPasienRekamMedis>;
};

type SourceRow = {
  id: string;
  created_at: string;
  pet_id: string | null;
  branch_id: string | null;
  dokter: string | null;
  keluhan: string | null;
  legacy_source_key: string | null;
  pets: Rel<{ name: string; species: string | null; breed: string | null }>;
  customers: Rel<{ name: string; phone: string | null }>;
  branches: Rel<{ code: string }>;
  medical_records: Rel<{ diagnosis: string | null; anamnesis: string | null }>;
  inpatient_records: Rel<CatatanStatusRawatInap>;
};

const dateText = (iso: string) => new Date(iso).toLocaleDateString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
});



export default async function DaftarRekamMedisPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pet?: string; hal?: string; tampilan?: string }>;
}) {
  const { q = "", pet: petId = "", hal, tampilan } = await searchParams;
  const fullHistory = tampilan === "semua" || !!petId;
  const displayMode = fullHistory ? "semua" : "rawat-jalan";
  const cari = q.trim();

  // Paginasi + pencarian di server: satu RPC SECURITY INVOKER (RLS pemanggil) mengembalikan jumlah + SATU halaman
  // (dulu seluruh daftar ~5 MB sekaligus, ~5 dtk, melewati batas 8 dtk). Klien TANPA header cabang + cabang aktif
  // sebagai parameter: cabang aktif + riwayat impor tanpa cabang. RLS tetap membatasi siapa melihat impor.
  let hasil: HalamanRekamMedis<SourceRow>;
  let cabangAktif: string | null;
  let pageInfo: ReturnType<typeof infoHalaman>;
  try {
    if (cari.length > MAKS_CARI_REKAM_MEDIS) throw new ListLoadError(PESAN_CARI_TERLALU_PANJANG);
    const lintas = await createClientLintasCabang();
    cabangAktif = lintas.cabangAktif;
    const baca = async (halaman: number) => {
      const diminta = { batas: HALAMAN_REKAM_MEDIS, offset: (halaman - 1) * HALAMAN_REKAM_MEDIS };
      const result = await lintas.client.rpc("daftar_rekam_medis_halaman", {
        p_cabang: cabangAktif, p_cari: cari || null, p_tampilan: displayMode, p_pet: petId || null,
        p_batas: diminta.batas, p_offset: diminta.offset,
      });
      return bacaHasilHalamanRekamMedis<SourceRow>(result, diminta, (pesan) => new ListLoadError(pesan));
    };
    const dimintaMentah = infoHalaman(hal, Number.MAX_SAFE_INTEGER, HALAMAN_REKAM_MEDIS).page;
    // offset RPC bertipe integer: nomor halaman absurd langsung dianggap di luar jangkauan (halaman 1).
    const diminta = (dimintaMentah - 1) * HALAMAN_REKAM_MEDIS > 2_000_000_000 ? 1 : dimintaMentah;
    hasil = await baca(diminta);
    pageInfo = infoHalaman(diminta, hasil.jumlah, HALAMAN_REKAM_MEDIS);
    // Halaman di luar jangkauan kembali ke halaman 1 (sama dengan perilaku infoHalaman), dibaca ulang.
    if (pageInfo.page !== diminta) {
      hasil = await baca(pageInfo.page);
      pageInfo = infoHalaman(pageInfo.page, hasil.jumlah, HALAMAN_REKAM_MEDIS);
    }
  } catch (error) { return <ListLoadFailure error={error} label="Rekam medis" />; }

  const rows: RekamRow[] = hasil.baris.map((visit) => {
    const pet = one(visit.pets);
    const owner = one(visit.customers);
    const branch = one(visit.branches);
    const medical = one(visit.medical_records);
    const invalidImportedOwner = Boolean(visit.legacy_source_key) && isPlaceholderOwnerName(owner?.name);
    return {
      id: visit.id,
      date: visit.created_at,
      petId: visit.pet_id,
      ownerName: invalidImportedOwner ? "Pemilik perlu verifikasi" : owner?.name ?? "—",
      petName: pet?.name ?? "—",
      phone: invalidImportedOwner ? "" : owner?.phone ?? "",
      species: pet?.species ?? null,
      breed: pet?.breed ?? null,
      doctor: visit.dokter,
      branch: branch?.code ?? null,
      note: medical?.anamnesis ?? visit.keluhan,
      diagnosis: medical?.diagnosis ?? null,
      isImported: Boolean(visit.legacy_source_key),
      activeInpatient: hasActiveInpatient(visit.inpatient_records),
      patientStatus: statusPasienRekamMedis(visit.inpatient_records, Boolean(visit.legacy_source_key)),
    };
  });
  const selectedPet = petId ? rows[0] : null;
  const subjudul = selectedPet
    ? `Riwayat ${selectedPet.petName} · ${selectedPet.ownerName}`
    : cabangAktif ? "Riwayat pemeriksaan cabang aktif + riwayat impor (semua cabang)" : "Riwayat pemeriksaan seluruh cabang klinik";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Klinik</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Rekam medis</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div className="pg-hd" style={{ marginBottom: 2 }}>REKAM MEDIS</div>
          <div className="pg-sub">{subjudul}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/klinik/rekam-medis/perlu-dilengkapi" className="btn-def" style={{ textDecoration: "none" }}>
            <i className="ti ti-clipboard-list" /> Perlu dilengkapi
          </Link>
          <Link href="/klinik/rekam-medis/impor" className="btn-acc" style={{ textDecoration: "none", background: "var(--posb)" }}>
            <i className="ti ti-file-import" /> Import rekam medis
          </Link>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Stat icon="ti-medical-cross" label="RIWAYAT TERSIMPAN" value={hasil.ringkasan.riwayat} color="var(--posb)" bg="#eff6ff" />
        <Stat icon="ti-paw" label="HEWAN TERCATAT" value={hasil.ringkasan.hewan} color="#16a34a" bg="#e8f5ee" />
        <Stat icon="ti-file-import" label="HASIL IMPORT" value={hasil.ringkasan.impor} color="#7c3aed" bg="#f3f0ff" />
      </div>

      <div className="crm-sec">
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <Link href={`/klinik/rekam-medis?${new URLSearchParams({q,tampilan:"rawat-jalan"})}`}>Daftar rekam medis · selain Rawat Inap aktif</Link>
          <Link href={`/klinik/rekam-medis?${new URLSearchParams({q,tampilan:"semua"})}`}>Semua riwayat (termasuk Rawat Inap)</Link>
          <Link href="/klinik/rawat-inap">Pasien Rawat Inap aktif</Link>
        </div>
        {!fullHistory && <p style={{ fontSize: 11 }}>Pasien Rawat Inap aktif ada di Status Rawat Inap. Riwayat medisnya tetap tersedia lewat Semua riwayat atau riwayat pasien.</p>}
        {cabangAktif && hasil.ringkasan.impor > 0 && (
          <p style={{ fontSize: 11, color: "var(--tm)" }}>
            Riwayat hasil impor tidak punya data cabang, jadi ikut tampil di setiap cabang dengan label <b>Impor</b>.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Daftar riwayat</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              {cari ? `${hasil.jumlah} riwayat ditemukan.` : selectedPet ? `Seluruh riwayat medis ${selectedPet.petName}.` : "Cari lewat nama pemilik, nama hewan, atau nomor telepon."}
            </div>
          </div>
          <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="hidden" name="tampilan" value={displayMode} />
            {petId && <input type="hidden" name="pet" value={petId} />}
            <input className="fi" name="q" defaultValue={q} maxLength={MAKS_CARI_REKAM_MEDIS} placeholder="Cari pemilik, hewan, atau telepon..." style={{ width: 240 }} />
            <button className="btn-def" type="submit"><i className="ti ti-search" /> Cari</button>
            {(q || petId) && <Link href="/klinik/rekam-medis?tampilan=semua" className="btn-def" style={{ textDecoration: "none" }}>Semua riwayat</Link>}
          </form>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "30px 12px", textAlign: "center", color: "var(--tm)", fontSize: 12 }}>
            <i className="ti ti-notes-off" style={{ display: "block", fontSize: 28, marginBottom: 7, color: "var(--td)" }} />
            {petId ? "Belum ada riwayat medis untuk anabul ini." : "Belum ada rekam medis yang cocok."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 850 }}>
              <thead>
                <tr><th>Tanggal</th><th>Pasien</th><th>Pemilik</th><th>Status pasien</th><th>Ringkasan kunjungan</th><th>Diagnosa</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{dateText(row.date)}<br />
                      <span style={{ fontSize: 10, color: "var(--td)" }}>{row.branch ?? (row.isImported ? LABEL_RIWAYAT_IMPOR : "Tanpa cabang")}</span>
                      {row.isImported && <><br /><span className="bge" title="Riwayat hasil impor data lama" style={{ fontSize: 9.5 }}>Impor</span></>}
                    </td>
                    <td><div style={{ fontWeight: 700 }}>{row.petName}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{[row.species, row.breed].filter(Boolean).join(" · ") || "—"}</div></td>
                    <td><div style={{ fontWeight: 600 }}>{row.ownerName}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.phone || "—"}</div></td>
                    <td style={{ whiteSpace: "nowrap" }}><span className={`bge ${row.patientStatus.badge}`}>{row.patientStatus.label}</span></td>
                    <td style={{ maxWidth: 230, fontSize: 11, lineHeight: 1.45 }}>{row.note || "—"}</td>
                    <td style={{ maxWidth: 190, fontSize: 11, lineHeight: 1.45 }}>{row.diagnosis || "Belum diisi"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <BukaRekamMedisLink href={`/klinik/rekam-medis/${row.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListPagination path="/klinik/rekam-medis" query={{ q, pet: petId, tampilan: displayMode }} total={hasil.jumlah} pageInfo={pageInfo} />
      </div>
    </>
  );
}

function Stat({ icon, label, value, color, bg }: { icon: string; label: string; value: number; color: string; bg: string }) {
  return (
    <div className="card" style={{ padding: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className={`ti ${icon}`} style={{ fontSize: 21, color }} />
        </div>
        <div><div style={{ fontSize: 9.5, fontWeight: 700, color, letterSpacing: ".03em" }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, color: "var(--sb)", lineHeight: 1.15 }}>{value}</div></div>
      </div>
    </div>
  );
}
