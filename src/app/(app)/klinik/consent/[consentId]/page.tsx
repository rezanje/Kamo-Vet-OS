import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { RekamMedisKop } from "@/components/RekamMedisKop";
import { bacaIdentitasKop } from "@/lib/cabang-identitas-server";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Lembar cetak form persetujuan — isi yang dicetak selalu dari isi_snapshot,
// bukan dari template (template bisa berubah setelah dokumen ditandatangani).
export default async function ConsentPrintPage({ params }: { params: Promise<{ consentId: string }> }) {
  const { consentId } = await params;
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("consents")
    .select("id, tindakan, isi_snapshot, status, signer_name, signature_data, signed_at, created_at, visit_id, visits(branch_id, dokter, pets(name, species), customers(name, phone), branches(name))")
    .eq("id", consentId)
    .maybeSingle();
  if (!c) notFound();

  const visit = one(c.visits as Rel<{ dokter: string | null; pets: Rel<{ name: string; species: string | null }>; customers: Rel<{ name: string; phone: string }>; branches: Rel<{ name: string }>; branch_id?: string | null }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const branch = one(visit?.branches ?? null);
  // Kop = identitas CABANG KUNJUNGAN (sama dengan rekam medis); gagal baca = nama cabang saja.
  const identitas = await bacaIdentitasKop(supabase, visit?.branch_id ?? null);

  const tgl = new Date(c.created_at as string).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/rekam-medis/${c.visit_id}`} className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali ke rekam medis
        </Link>
        <PrintButton />
      </div>

      <div className="rm-doc" style={{ maxWidth: 640, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10, padding: "30px 34px", fontSize: 12.5, color: "#141413" }}>
        <div style={{ textAlign: "center", borderBottom: "2px solid #16213e", paddingBottom: 12, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <RekamMedisKop nama={branch?.name} alamat={identitas.alamat} telepon={identitas.telepon} logoUrl={identitas.logoUrl} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 10, letterSpacing: ".03em" }}>SURAT PERSETUJUAN TINDAKAN</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 18px", fontSize: 11.5, marginBottom: 18 }}>
          <Kv k="Pemilik" v={cust?.name} />
          <Kv k="Tanggal" v={tgl} />
          <Kv k="No. HP" v={cust?.phone} />
          <Kv k="Dokter" v={visit?.dokter} />
          <Kv k="Hewan" v={pet ? `${pet.name}${pet.species ? ` (${pet.species})` : ""}` : null} />
          <Kv k="Tindakan" v={c.tindakan as string} />
        </div>

        <div style={{ whiteSpace: "pre-line", lineHeight: 1.75, textAlign: "justify", marginBottom: 26 }}>
          {c.isi_snapshot}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ textAlign: "center", minWidth: 220 }}>
            <div style={{ fontSize: 11.5, marginBottom: 4 }}>Yang menyatakan,</div>
            {c.status === "sudah_ttd" && c.signature_data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.signature_data as string} alt="Tanda tangan" style={{ height: 80, objectFit: "contain" }} />
            ) : (
              <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: "#b91c1c", fontStyle: "italic" }}>
                (belum ditandatangani)
              </div>
            )}
            <div style={{ borderTop: "1px solid #141413", paddingTop: 4, fontSize: 11.5, fontWeight: 600 }}>
              {(c.signer_name as string) || cust?.name || "—"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Kv({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "var(--tm)", minWidth: 66 }}>{k}</span>
      <span style={{ fontWeight: 500 }}>: {v || "—"}</span>
    </div>
  );
}
