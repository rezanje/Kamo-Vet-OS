import { ListLoadError, TABLE_PAGE_SIZE } from "@/lib/checked-list";
import { infoHalaman } from "@/lib/pagination";
import { ListPagination, ListLoadFailure } from "@/components/ListPagination";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { bacaHasilDaftarRekamMedis, saringDaftarRekamMedis, type BarisDaftarRekamMedis } from "@/lib/daftar-rekam-medis";
import { isPlaceholderOwnerName } from "@/lib/impor-rekam-medis";
import { hasActiveInpatient, statusPasienRekamMedis, type CatatanStatusRawatInap } from "@/lib/status-pasien-rekam-medis";
import { adalahRiwayatBersama, bacaRiwayatBersamaHewan, ownerAktif, PESAN_GAGAL_RIWAYAT_BERSAMA, type RiwayatBersama } from "@/lib/riwayat-bersama";
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

const dateText = (iso: string) => new Date(iso).toLocaleDateString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
});

export default async function DaftarRekamMedisPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pet?: string; hal?: string; tampilan?: string }>;
}) {
  const { q = "", pet: petId = "", hal, tampilan } = await searchParams;
  const supabase = await createClient();

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

  let data: SourceRow[];
  try {
    // Satu RPC SECURITY INVOKER (RLS pemanggil) = satu snapshot. Dulu 8 halaman PostgREST paralel yang masing-masing
    // mengevaluasi RLS seluruh tabel dua kali; dengan ~3.800 riwayat impor itu melewati batas 8 detik di Production.
    const result = await supabase.rpc("daftar_rekam_medis", { p_pet: petId || null });
    data = bacaHasilDaftarRekamMedis<SourceRow>(result, (pesan) => new ListLoadError(pesan));
  } catch (error) { return <ListLoadFailure error={error} label="Rekam medis" />; }

  // RS-2: riwayat bersama hasil impor (tanpa cabang) satu hewan untuk OWNER aktif. Dibaca lewat RPC baca-saja
  // di cabang aktif maupun "Semua cabang", jadi tampilannya sama; baris yang sama dari SELECT biasa diganti,
  // bukan digandakan. Gagal/terlalu banyak = halaman gagal, tidak pernah dianggap kosong atau lengkap.
  type PetRow = { id: string; customer_id: string | null; name: string | null; species: string | null; breed: string | null; customers: Rel<{ name: string; phone: string | null }> };
  let shared: RiwayatBersama[] = [];
  let sharedPet: PetRow | null = null;
  const replaced = new Set<string>();
  if (petId) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (await ownerAktif(supabase, user?.id)) {
        const { data: pet, error } = await supabase.from("pets")
          .select("id, customer_id, name, species, breed, customers(name, phone)").eq("id", petId).maybeSingle();
        if (error) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
        if (pet) {
          if (typeof pet.customer_id !== "string") throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
          sharedPet = pet as PetRow;
          shared = await bacaRiwayatBersamaHewan(supabase, petId, pet.customer_id);
        }
        const sharedIds = new Set(shared.map((row) => row.visit_id));
        for (const visit of data) {
          if (!adalahRiwayatBersama(visit)) continue;
          // Riwayat bersama yang terlihat di SELECT biasa tapi ditolak pembaca (relasi tidak konsisten) = gagal.
          if (!sharedIds.has(visit.id)) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
          replaced.add(visit.id);
        }
      }
    } catch (error) { return <ListLoadFailure error={error} label="Rekam medis" />; }
  }

  const sharedOwner = one(sharedPet?.customers ?? null);
  const sharedOwnerInvalid = isPlaceholderOwnerName(sharedOwner?.name);
  const sharedRows: RekamRow[] = shared.map((row) => ({
    id: row.visit_id,
    date: row.tanggal,
    petId: row.pet_id,
    ownerName: sharedOwnerInvalid ? "Pemilik perlu verifikasi" : sharedOwner?.name ?? "—",
    petName: sharedPet?.name ?? "—",
    phone: sharedOwnerInvalid ? "" : sharedOwner?.phone ?? "",
    species: sharedPet?.species ?? null,
    breed: sharedPet?.breed ?? null,
    doctor: row.dokter,
    branch: null,
    note: row.anamnesis ?? row.keluhan,
    diagnosis: row.diagnosis,
    isImported: true,
    activeInpatient: false,
    patientStatus: statusPasienRekamMedis(null, true),
  }));

  const normalRows: RekamRow[] = data.filter((visit) => !replaced.has(visit.id)).map((visit) => {
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
  // Urutan sama dengan query biasa: terbaru dulu, lalu id.
  const rows = sharedRows.length
    ? [...normalRows, ...sharedRows].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    : normalRows;
  const fullHistory = tampilan === "semua" || !!petId;
  const displayMode = fullHistory ? "semua" : "rawat-jalan";
  const filtered = saringDaftarRekamMedis(fullHistory ? rows : rows.filter(row => !row.activeInpatient), q);
  const pageInfo = infoHalaman(hal, filtered.length, TABLE_PAGE_SIZE);
  const visibleRows = filtered.slice(pageInfo.from, pageInfo.to + 1);
  const pets = new Set(rows.map((row) => row.petId).filter(Boolean)).size;
  const imported = rows.filter((row) => row.isImported).length;
  const selectedPet = petId ? rows[0] : null;

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
          <div className="pg-sub">
            {selectedPet ? `Riwayat ${selectedPet.petName} · ${selectedPet.ownerName}` : "Riwayat pemeriksaan seluruh cabang klinik"}
          </div>
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
        <Stat icon="ti-medical-cross" label="RIWAYAT TERSIMPAN" value={rows.length} color="var(--posb)" bg="#eff6ff" />
        <Stat icon="ti-paw" label="HEWAN TERCATAT" value={pets} color="#16a34a" bg="#e8f5ee" />
        <Stat icon="ti-file-import" label="HASIL IMPORT" value={imported} color="#7c3aed" bg="#f3f0ff" />
      </div>

      <div className="crm-sec">
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <Link href={`/klinik/rekam-medis?${new URLSearchParams({q,tampilan:"rawat-jalan"})}`}>Daftar rekam medis · selain Rawat Inap aktif</Link>
          <Link href={`/klinik/rekam-medis?${new URLSearchParams({q,tampilan:"semua"})}`}>Semua riwayat (termasuk Rawat Inap)</Link>
          <Link href="/klinik/rawat-inap">Pasien Rawat Inap aktif</Link>
        </div>
        {!fullHistory && <p style={{ fontSize: 11 }}>Pasien Rawat Inap aktif ada di Status Rawat Inap. Riwayat medisnya tetap tersedia lewat Semua riwayat atau riwayat pasien.</p>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Daftar riwayat</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              {q ? `${filtered.length} riwayat ditemukan.` : selectedPet ? `Seluruh riwayat medis ${selectedPet.petName}.` : "Cari lewat nama pemilik, nama hewan, atau nomor telepon."}
            </div>
          </div>
          <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="hidden" name="tampilan" value={displayMode} />
            {petId && <input type="hidden" name="pet" value={petId} />}
            <input className="fi" name="q" defaultValue={q} placeholder="Cari owner atau hewan..." style={{ width: 240 }} />
            <button className="btn-def" type="submit"><i className="ti ti-search" /> Cari</button>
            {(q || petId) && <Link href="/klinik/rekam-medis?tampilan=semua" className="btn-def" style={{ textDecoration: "none" }}>Semua riwayat</Link>}
          </form>
        </div>

        {filtered.length === 0 ? (
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
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{dateText(row.date)}<br />
                      <span style={{ fontSize: 10, color: "var(--td)" }}>{row.branch ?? "Riwayat lama · semua cabang"}</span>
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
        <ListPagination path="/klinik/rekam-medis" query={{ q, pet: petId, tampilan: displayMode }} total={filtered.length} pageInfo={pageInfo} />
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
