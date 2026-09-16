import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saringDaftarRekamMedis, type BarisDaftarRekamMedis } from "@/lib/daftar-rekam-medis";
import { BukaRekamMedisLink } from "./BukaRekamMedisLink";

type Rel<T> = T | T[] | null;

function one<T>(value: Rel<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type RekamRow = BarisDaftarRekamMedis & {
  id: string;
  date: string;
  species: string | null;
  breed: string | null;
  doctor: string | null;
  branch: string | null;
  note: string | null;
  diagnosis: string | null;
  isImported: boolean;
};

const dateText = (iso: string) => new Date(iso).toLocaleDateString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
});

export default async function DaftarRekamMedisPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pet?: string }>;
}) {
  const { q = "", pet: petId = "" } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("visits")
    .select("id, created_at, dokter, keluhan, legacy_source_key, pets(name, species, breed), customers(name, phone), branches(code), medical_records!inner(diagnosis, anamnesis)")
    .order("created_at", { ascending: false });
  if (petId) query = query.eq("pet_id", petId);
  const { data } = await query.limit(300);

  type SourceRow = {
    id: string;
    created_at: string;
    dokter: string | null;
    keluhan: string | null;
    legacy_source_key: string | null;
    pets: Rel<{ name: string; species: string | null; breed: string | null }>;
    customers: Rel<{ name: string; phone: string | null }>;
    branches: Rel<{ code: string }>;
    medical_records: Rel<{ diagnosis: string | null; anamnesis: string | null }>;
  };

  const rows: RekamRow[] = ((data ?? []) as unknown as SourceRow[]).map((visit) => {
    const pet = one(visit.pets);
    const owner = one(visit.customers);
    const branch = one(visit.branches);
    const medical = one(visit.medical_records);
    return {
      id: visit.id,
      date: visit.created_at,
      ownerName: owner?.name ?? "—",
      petName: pet?.name ?? "—",
      phone: owner?.phone ?? "",
      species: pet?.species ?? null,
      breed: pet?.breed ?? null,
      doctor: visit.dokter,
      branch: branch?.code ?? null,
      note: medical?.anamnesis ?? visit.keluhan,
      diagnosis: medical?.diagnosis ?? null,
      isImported: Boolean(visit.legacy_source_key),
    };
  });
  const filtered = saringDaftarRekamMedis(rows, q);
  const pets = new Set(rows.map((row) => row.petName).filter((name) => name !== "—")).size;
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
        <Link href="/klinik/rekam-medis/impor" className="btn-acc" style={{ textDecoration: "none", background: "var(--posb)" }}>
          <i className="ti ti-file-import" /> Import rekam medis
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Stat icon="ti-notes-medical" label="RIWAYAT TERSIMPAN" value={rows.length} color="var(--posb)" bg="#eff6ff" />
        <Stat icon="ti-paw" label="HEWAN TERCATAT" value={pets} color="#16a34a" bg="#e8f5ee" />
        <Stat icon="ti-file-import" label="HASIL IMPORT" value={imported} color="#7c3aed" bg="#f3f0ff" />
      </div>

      <div className="crm-sec">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Daftar riwayat</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              {q ? `${filtered.length} riwayat ditemukan.` : selectedPet ? `Seluruh riwayat medis ${selectedPet.petName}.` : "Cari lewat nama pemilik, nama hewan, atau nomor telepon."}
            </div>
          </div>
          <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {petId && <input type="hidden" name="pet" value={petId} />}
            <input className="fi" name="q" defaultValue={q} placeholder="Cari owner atau hewan..." style={{ width: 240 }} />
            <button className="btn-def" type="submit"><i className="ti ti-search" /> Cari</button>
            {(q || petId) && <Link href="/klinik/rekam-medis" className="btn-def" style={{ textDecoration: "none" }}>Semua riwayat</Link>}
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
                <tr><th>Tanggal</th><th>Pasien</th><th>Pemilik</th><th>Ringkasan kunjungan</th><th>Diagnosa</th><th /></tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>{dateText(row.date)}<br />
                      <span style={{ fontSize: 10, color: "var(--td)" }}>{row.branch ?? "Riwayat lama · semua cabang"}</span>
                    </td>
                    <td><div style={{ fontWeight: 700 }}>{row.petName}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{[row.species, row.breed].filter(Boolean).join(" · ") || "—"}</div></td>
                    <td><div style={{ fontWeight: 600 }}>{row.ownerName}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.phone || "—"}</div></td>
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
