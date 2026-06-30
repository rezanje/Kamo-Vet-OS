import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PembayaranForm } from "./PembayaranForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const STEPS = ["Pendaftaran", "Antrian", "Rekam Medis", "Pembayaran"];
const STEP_BY_STATUS: Record<string, number> = { Menunggu: 1, Diperiksa: 2, Pembayaran: 3, Selesai: 4 };

export default async function PembayaranPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { visitId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, status, poli, dokter, created_at, pets(name, species, weight), customers(name, phone)")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) notFound();

  // butuh rekam medis dulu sebelum bayar.
  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!mr) redirect(`/klinik/rekam-medis/${visitId}`);

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const activeStep = STEP_BY_STATUS[visit.status] ?? 3;

  // invoice tersimpan (kalau sudah dibayar) untuk tampilan read-only.
  const { data: invoice } = await supabase
    .from("invoices").select("id, subtotal, discount, total, dp_amount, dp_date, paid_status, paid_at").eq("visit_id", visitId).maybeSingle();
  const { data: invItems } = invoice
    ? await supabase.from("invoice_items").select("deskripsi, qty, harga").eq("invoice_id", invoice.id).order("created_at")
    : { data: [] as { deskripsi: string; qty: number; harga: number }[] };

  // prefill item dari resep saat belum bayar: jasa konsultasi + tiap obat (harga diisi kasir).
  const { data: resep } = await supabase.from("prescription_items").select("nama_obat, qty").eq("medical_record_id", mr.id).order("created_at");
  const prefill = [
    { deskripsi: `Jasa Konsultasi ${visit.poli}`, qty: 1, harga: 0 },
    ...(resep ?? []).map((r) => ({ deskripsi: r.nama_obat, qty: r.qty, harga: 0 })),
  ];

  const lunas = invoice?.paid_status === "Lunas";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/antrian" className="back-btn"><i className="ti ti-arrow-left" /> Antrian</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pembayaran</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {/* Stepper */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {STEPS.map((s, i) => {
            const done = i < activeStep, active = i === activeStep;
            const color = done ? "#16a34a" : active ? "var(--acc)" : "var(--td)";
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                    background: done ? "#16a34a" : active ? "var(--acc)" : "#f3f4f6",
                    color: done || active ? "#fff" : "var(--td)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600,
                  }}>{done ? <i className="ti ti-check" /> : i + 1}</span>
                  <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, color }}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1.5, background: done ? "#16a34a" : "var(--bd)", margin: "0 9px" }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pasien */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 28px" }}>
          <Field label="Pasien" value={`${pet?.name ?? "—"} · ${pet?.species ?? ""}`} />
          <Field label="Pemilik" value={`${cust?.name ?? "—"} · ${cust?.phone ?? ""}`} />
          <Field label="Poli" value={visit.poli} />
          {visit.dokter && <Field label="Dokter" value={visit.dokter} />}
        </div>
      </div>

      {invoice ? (
        <>
          <div className="p2ban" style={{ background: lunas ? "#e8f5ee" : "#fffbeb", border: `.5px solid ${lunas ? "#86efac" : "#fcd34d"}`, color: lunas ? "#15803d" : "#92400e" }}>
            <i className={`ti ti-${lunas ? "circle-check" : "clock-dollar"}`} /> Status: {invoice.paid_status}
            {invoice.paid_status === "DP" && ` — DP ${rp(invoice.dp_amount)}, sisa ${rp(invoice.total - invoice.dp_amount)}`}
          </div>
          <div className="card">
            <div className="card-hd"><i className="ti ti-receipt" style={{ color: "var(--acc)" }} /> Rincian tagihan</div>
            <table className="tbl">
              <thead><tr><th>Item</th><th style={{ textAlign: "center" }}>Qty</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "right" }}>Subtotal</th></tr></thead>
              <tbody>
                {(invItems ?? []).map((l, i) => (
                  <tr key={i}><td style={{ fontWeight: 500 }}>{l.deskripsi}</td><td style={{ textAlign: "center" }}>{l.qty}</td><td style={{ textAlign: "right" }}>{rp(l.harga)}</td><td style={{ textAlign: "right" }}>{rp(l.qty * l.harga)}</td></tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10, marginLeft: "auto", width: 220 }}>
              <SumRow label="Subtotal" value={rp(invoice.subtotal)} />
              {invoice.discount > 0 && <SumRow label="Diskon" value={`- ${rp(invoice.discount)}`} />}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
                <span style={{ fontWeight: 600 }}>Total</span>
                <span style={{ fontWeight: 700, color: "var(--acc)" }}>{rp(invoice.total)}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <PembayaranForm visitId={visit.id} initialItems={prefill} />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div><div style={{ fontSize: 12 }}>{value}</div></div>;
}
function SumRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}><span style={{ color: "var(--tm)" }}>{label}</span><span>{value}</span></div>;
}
