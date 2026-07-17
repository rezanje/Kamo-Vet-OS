import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { RiwayatTabs, type MedEntry, type RacikanEntry, type InapEntry, type InvoiceEntry } from "./RiwayatTabs";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
function many<T>(r: Rel<T>): T[] {
  return Array.isArray(r) ? r : r ? [r] : [];
}

function petAge(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = new Date(dob), now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months--;
  if (months < 0) return null;
  const y = Math.floor(months / 12), m = months % 12;
  return `${y} Tahun ${m} Bulan`;
}
const fmtDateLong = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—";
const fmtDaftar = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// warna titik timeline per poli (fallback siklus).
const POLI_COLOR: Record<string, string> = {
  "Poli Umum": "#2563eb", "Poli Gigi": "#7c3aed", "Poli Kulit": "#ec4899", "Vaksinasi": "#d97706", "Grooming": "#16a34a",
};
const CYCLE = ["#2563eb", "#16a34a", "#7c3aed", "#d97706", "#ec4899"];

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, pet_id, created_at, pets(id, name, species, breed, dob, gender, weight, warna, sterilisasi, microchip, alergi, kondisi_khusus, golongan_darah, photo_url, created_at), customers(id, name, phone, email, address, tier, points), branches(name, code)")
    .eq("id", id)
    .maybeSingle();

  if (!visit) notFound();

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const branch = one(visit.branches);
  const age = petAge(pet?.dob);

  // No. ID pasien turunan: PET-<yymmdd daftar>-<4 char id>
  const petIdCode = pet
    ? `PET-${new Date(pet.created_at as string).toISOString().slice(2, 10).replace(/-/g, "")}-${(pet.id as string).slice(0, 4).toUpperCase()}`
    : "—";

  // ===== Riwayat medis (semua kunjungan hewan ini) =====
  const { data: history } = pet
    ? await supabase
        .from("visits")
        .select("id, poli, dokter, keluhan, created_at, medical_records(diagnosis, anamnesis, created_at, prescription_items(id)), invoices(invoice_items(id, deskripsi))")
        .eq("pet_id", pet.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const med: MedEntry[] = (history ?? []).map((v, i) => {
    const mrs = many(v.medical_records).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const mr = mrs[0];
    const resepCount = mrs.reduce((n, m) => n + many(m.prescription_items).length, 0);
    const inv = one(v.invoices);
    const items = inv ? many(inv.invoice_items) : [];
    return {
      visitId: v.id as string,
      date: v.created_at as string,
      poli: v.poli as string,
      dokter: v.dokter as string | null,
      keluhan: (v.keluhan as string | null) ?? (mr?.anamnesis ?? null),
      diagnosis: mr?.diagnosis ?? null,
      tindakan: items[0]?.deskripsi ?? null,
      tindakanCount: items.length,
      resepCount,
      color: POLI_COLOR[v.poli as string] ?? CYCLE[i % CYCLE.length],
    };
  });

  // ===== Rawat inap + Racikan (independen → barengan) =====
  const visitIds = (history ?? []).map((v) => v.id as string);
  const [{ data: inapRows }, { data: racikRows }] = visitIds.length
    ? await Promise.all([
        supabase.from("inpatient_records")
          .select("id, visit_id, doctor_name, condition_status, admitted_at, discharged_at")
          .in("visit_id", visitIds).order("admitted_at", { ascending: false }),
        supabase.from("compounding_recipes")
          .select("id, recipe_name, dosage_form, total_volume, status, created_at, medical_records!inner(visit_id)")
          .in("medical_records.visit_id", visitIds).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const inap: InapEntry[] = (inapRows ?? []).map((r) => ({
    id: r.id as string, visitId: r.visit_id as string, doctor: r.doctor_name as string | null,
    condition: r.condition_status as string, admitted: r.admitted_at as string, discharged: r.discharged_at as string | null,
  }));
  const racikan: RacikanEntry[] = (racikRows ?? []).map((r) => ({
    id: r.id as string, recipe_name: r.recipe_name as string, dosage_form: r.dosage_form as string,
    total_volume: r.total_volume as string, status: r.status as string, date: r.created_at as string,
  }));

  // ===== Ringkasan transaksi customer (petshop + klinik, semua waktu) =====
  const [{ data: salesAgg }, { data: invAgg }] = cust?.id
    ? await Promise.all([
        supabase.from("sales").select("total").eq("customer_id", cust.id),
        supabase
          .from("invoices")
          .select("total, visits!inner(customer_id)")
          .eq("paid_status", "Lunas")
          .is("voided_at", null)
          .eq("visits.customer_id", cust.id),
      ])
    : [{ data: [] }, { data: [] }];
  const trxTotals = [
    ...((salesAgg ?? []) as { total: number }[]).map((s) => Number(s.total || 0)),
    ...((invAgg ?? []) as { total: number }[]).map((iv) => Number(iv.total || 0)),
  ];
  const trxCount = trxTotals.length;
  const trxSum = trxTotals.reduce((a, b) => a + b, 0);
  const trxAvg = trxCount ? trxSum / trxCount : 0;
  const poin = cust?.points ?? 0;

  // ===== Invoice =====
  const invoices: InvoiceEntry[] = (history ?? [])
    .map((v) => {
      const inv = one(v.invoices) as { total?: number; paid_status?: string } | null;
      return inv && inv.total !== undefined
        ? { visitId: v.id as string, total: Number(inv.total), paid_status: (inv.paid_status as string) ?? "Belum Lunas", date: v.created_at as string }
        : null;
    })
    .filter(Boolean) as InvoiceEntry[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Link href="/klinik/antrian" className="back-btn" style={{ fontSize: 13 }}>
          <i className="ti ti-arrow-left" /> Kembali ke Antrian
        </Link>
        <span style={{ fontSize: 11, color: "var(--td)" }}>Antrian Pasien › Detail Pasien</span>
      </div>

      {/* ===== Header owner ===== */}
      <div className="card" style={{ marginBottom: 14, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 220 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className="ti ti-user" style={{ fontSize: 26, color: "#2563eb" }} />
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".05em" }}>OWNER / PEMILIK</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>{cust?.name ?? "—"}</div>
              <div style={{ fontSize: 11.5, color: "#2563eb", marginTop: 2 }}><i className="ti ti-phone" style={{ fontSize: 12 }} /> {cust?.phone ?? "—"}</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, borderLeft: ".5px solid var(--bd)", paddingLeft: 18, minWidth: 480 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 4 }}>KATEGORI PELANGGAN</div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--sf1)", border: ".5px solid var(--bd)", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600 }}>
                <i className="ti ti-award" style={{ color: "#9ca3af" }} /> {cust?.tier ?? "—"}
              </span>
            </div>
            <HeadCell icon="ti-map-pin" label="ALAMAT" value={cust?.address ?? "—"} />
            <HeadCell icon="ti-building-store" label="CABANG" value={branch?.name ?? "—"} />
            <HeadCell icon="ti-calendar" label="TANGGAL DAFTAR" value={fmtDaftar(visit.created_at as string)} />
          </div>
          <PrintButton label="Cetak" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, borderTop: ".5px solid var(--bd)", marginTop: 14, paddingTop: 14 }}>
          <HeadCell icon="ti-trending-up" label="RATA-RATA TRANSAKSI" value={rp(trxAvg)} />
          <HeadCell icon="ti-star" label="POIN" value={`${poin.toLocaleString("id-ID")} Poin`} />
          <HeadCell icon="ti-shopping-bag" label="TOTAL TRANSAKSI" value={`${trxCount}x · ${rp(trxSum)}`} />
        </div>
      </div>

      {/* ===== Body: kiri info anabul, kanan tabs ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 14, alignItems: "start" }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em" }}>INFORMASI ANABUL</div>
          </div>
          <div style={{ width: "100%", aspectRatio: "1 / 1", maxWidth: 200, margin: "0 auto 14px", borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {pet?.photo_url
              ? <img src={pet.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <i className="ti ti-paw" style={{ fontSize: 54, color: "var(--td)" }} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>{pet?.name ?? "—"}</span>
            <i className={`ti ${pet?.gender === "Betina" ? "ti-gender-female" : "ti-gender-male"}`} style={{ color: "#2563eb", fontSize: 18 }} />
            <span className="bge b">{pet?.species ?? "—"}</span>
          </div>
          <div>
            <InfoRow label="Jenis" value={pet?.breed} />
            <InfoRow label="Tanggal Lahir" value={fmtDateLong(pet?.dob ?? null)} />
            <InfoRow label="Umur" value={age} />
            <InfoRow label="Berat Badan" value={pet?.weight != null ? `${pet.weight} kg` : null} />
            <InfoRow label="Warna" value={pet?.warna} />
            <InfoRow label="Status Reproduksi" value={pet?.sterilisasi} />
            <InfoRow label="No. ID Pasien" value={petIdCode} />
            <InfoRow label="Alergi" value={pet?.alergi} />
            <InfoRow label="Catatan Khusus" value={pet?.kondisi_khusus} />
          </div>
          <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 12, marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginBottom: 3 }}><i className="ti ti-info-circle" /> Catatan</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", lineHeight: 1.5 }}>
              Riwayat medis menampilkan kunjungan terakhir dan tindakan yang pernah dilakukan pada anabul.
            </div>
          </div>
        </div>

        <RiwayatTabs med={med} racikan={racikan} inap={inap} invoices={invoices} />
      </div>
    </>
  );
}

function HeadCell({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`ti ${icon}`} style={{ color: "#2563eb", fontSize: 16 }} />
      </div>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em" }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx)", marginTop: 1 }}>{value}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 6, padding: "5px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
