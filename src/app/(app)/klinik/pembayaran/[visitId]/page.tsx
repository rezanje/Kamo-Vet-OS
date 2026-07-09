import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { PembayaranForm } from "./PembayaranForm";
import { SubmitButton } from "@/components/SubmitButton";
import { voidAndReissue } from "./actions";

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
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { visitId } = await params;
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, status, poli, dokter, created_at, pets(name, species, weight, photo_url), customers(name, phone, address)")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) notFound();

  // butuh rekam medis dulu sebelum bayar.
  const { data: mr } = await supabase
    .from("medical_records").select("id, catatan_resep").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!mr) redirect(`/klinik/rekam-medis/${visitId}`);

  // jenis layanan: rawat inap kalau ada record inpatient, selain itu poli.
  const { data: inpat } = await supabase.from("inpatient_records").select("id").eq("visit_id", visitId).limit(1).maybeSingle();
  const jenisLayanan = inpat ? "Rawat Inap" : visit.poli;

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const activeStep = STEP_BY_STATUS[visit.status] ?? 3;

  // invoice AKTIF (belum di-void) — voided tetap tersimpan utk riwayat (Addendum §7).
  const { data: invoice } = await supabase
    .from("invoices").select("id, invoice_no, subtotal, discount, tax, total, dp_amount, dp_date, paid_status, metode_bayar, paid_at, reissued_from, created_at")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();
  const { data: invItems } = invoice
    ? await supabase.from("invoice_items").select("deskripsi, qty, harga, jenis").eq("invoice_id", invoice.id).order("created_at")
    : { data: [] as { deskripsi: string; qty: number; harga: number; jenis: string }[] };

  // riwayat audit: log invoice aktif + log invoice lama (voided) utk visit ini.
  const { data: allInvIds } = await supabase.from("invoices").select("id, invoice_no").eq("visit_id", visitId);
  const { data: editLog } = (allInvIds ?? []).length
    ? await supabase
        .from("invoice_edit_log")
        .select("field_changed, old_value, new_value, reason, edited_at, invoice_id, profiles(full_name)")
        .in("invoice_id", (allInvIds ?? []).map((x) => x.id))
        .order("edited_at", { ascending: false })
    : { data: [] };

  // prefill item dari resep saat belum bayar: harga sudah diisi dokter di POS rekam medis
  // (kasir tetap boleh edit). Fallback jasa konsultasi kalau dokter tak input item apa pun.
  const { data: resep } = await supabase.from("prescription_items").select("nama_obat, qty, harga, jenis").eq("medical_record_id", mr.id).order("created_at");
  const resepRows = (resep ?? []).map((r) => ({ deskripsi: r.nama_obat, qty: r.qty, harga: Number(r.harga) || 0, jenis: r.jenis ?? "obat" }));
  const prefill = resepRows.length
    ? resepRows
    : [{ deskripsi: `Jasa Konsultasi ${visit.poli}`, qty: 1, harga: 0, jenis: "jasa" }];

  const lunas = invoice?.paid_status === "Lunas";

  // Split obat vs jasa dari kolom `jenis` (2 tabel gaya referensi).
  const sourceItems = invoice
    ? (invItems ?? []).map((l) => ({ deskripsi: l.deskripsi, qty: Number(l.qty), harga: Number(l.harga), jenis: l.jenis ?? "obat" }))
    : prefill;
  const initialObat = sourceItems.filter((r) => r.jenis !== "jasa");
  const initialJasa = sourceItems.filter((r) => r.jenis === "jasa");

  const patient = {
    photo: pet?.photo_url ?? null,
    name: pet?.name ?? "—",
    species: pet?.species ?? "—",
    owner: cust?.name ?? "—",
    phone: cust?.phone ?? "—",
    address: cust?.address ?? "—",
    dokter: visit.dokter ?? "—",
    jenisLayanan,
    noInvoice: invoice?.invoice_no ?? "(baru)",
    tanggal: new Date((invoice?.created_at as string) ?? visit.created_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };

  // Addendum §1: pembayaran klinik hanya bisa saat shift klinik terbuka (gate server-side).
  if (!lunas) {
    const { data: { user } } = await supabase.auth.getUser();
    const shift = user ? await getOpenShift(supabase as never, user.id, "klinik") : null;
    if (!shift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);
  }

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik/antrian" className="back-btn"><i className="ti ti-arrow-left" /> Antrian</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-file-invoice" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>INVOICE / PEMBAYARAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Detail tagihan dan metode pembayaran</div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success === "bayar" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Pembayaran berhasil. Cetak struk / invoice di bawah.
        </div>
      )}
      {success === "edit" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Invoice diperbarui — perubahan tercatat di riwayat audit.
        </div>
      )}
      {success === "reissue" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Invoice lama di-void, invoice baru diterbitkan (Belum Lunas).
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

      {/* Pasien (hanya di tampilan read-only invoice; form editable punya header sendiri) */}
      {invoice && !(edit === "1" && !lunas) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 28px" }}>
            <Field label="Pasien" value={`${pet?.name ?? "—"} · ${pet?.species ?? ""}`} />
            <Field label="Pemilik" value={`${cust?.name ?? "—"} · ${cust?.phone ?? ""}`} />
            <Field label="Poli" value={visit.poli} />
            {visit.dokter && <Field label="Dokter" value={visit.dokter} />}
          </div>
        </div>
      )}

      {invoice && edit === "1" && !lunas ? (
        <>
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
            <i className="ti ti-pencil" /> Mode edit invoice {invoice.invoice_no} — perubahan nominal/item wajib alasan & tercatat.
          </div>
          <PembayaranForm
            visitId={visit.id}
            patient={patient}
            initialObat={initialObat}
            initialJasa={initialJasa}
            catatanResep={mr.catatan_resep}
            initialDiscount={Number(invoice.discount)}
            initialDpAmount={Number(invoice.dp_amount)}
            initialDpDate={invoice.dp_date}
            editMode
          />
        </>
      ) : invoice ? (
        <>
          <div className="p2ban" style={{ background: lunas ? "#e8f5ee" : "#fffbeb", border: `.5px solid ${lunas ? "#86efac" : "#fcd34d"}`, color: lunas ? "#15803d" : "#92400e" }}>
            <i className={`ti ti-${lunas ? "circle-check" : "clock-dollar"}`} /> Status: {invoice.paid_status}
            {invoice.paid_status === "DP" && ` — DP ${rp(invoice.dp_amount)}, sisa ${rp(invoice.total - invoice.dp_amount)}`}
            {(editLog ?? []).length > 0 && (
              <span className="bge o" style={{ marginLeft: 8 }}><i className="ti ti-pencil" /> Diedit</span>
            )}
            {invoice.reissued_from && (
              <span className="bge b" style={{ marginLeft: 6 }}><i className="ti ti-rotate" /> Terbit ulang</span>
            )}
          </div>
          <div className="card">
            <div className="card-hd" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i className="ti ti-receipt" style={{ color: "var(--acc)" }} /> {invoice.invoice_no ?? "Rincian tagihan"}
                <span style={{ fontSize: 10, fontWeight: 400, color: "var(--tm)" }}>· {invoice.metode_bayar ?? "—"}</span>
              </span>
              <span style={{ display: "flex", gap: 5 }}>
                {!lunas && (
                  <Link href={`/klinik/pembayaran/${visit.id}?edit=1`} className="btn-def"
                    style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-pencil" /> Edit Invoice
                  </Link>
                )}
                {lunas && (
                  <Link href={`/klinik/pembayaran/${visit.id}/struk`} className="btn-def"
                    style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-receipt-2" /> Struk
                  </Link>
                )}
                <Link href={`/klinik/pembayaran/${visit.id}/invoice`} className="btn-acc"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-file-invoice" /> Invoice
                </Link>
              </span>
            </div>
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
              <SumRow label="PPN 11%" value={rp(invoice.tax)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
                <span style={{ fontWeight: 600 }}>Total</span>
                <span style={{ fontWeight: 700, color: "var(--acc)" }}>{rp(invoice.total)}</span>
              </div>
            </div>
          </div>

          {/* Void & Reissue — hanya invoice lunas (Addendum §7). */}
          {lunas && (
            <div className="card" style={{ marginTop: 12, borderColor: "#fca5a5" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>
                <i className="ti ti-file-x" /> VOID &amp; TERBITKAN ULANG
              </div>
              <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>
                Invoice lunas tidak boleh diedit langsung. Void membatalkan invoice ini (jurnal dibalik otomatis) dan menerbitkan invoice baru berstatus Belum Lunas untuk dikoreksi.
              </div>
              <form action={voidAndReissue} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <input type="hidden" name="visitId" value={visit.id} />
                <div style={{ flex: 1 }}>
                  <label className="flab">Alasan void *</label>
                  <input className="fi" name="reason" required placeholder="mis. salah tagih jasa rawat inap" />
                </div>
                <SubmitButton className="btn-def" icon="ti-file-x" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} pendingText="Memproses…">Void &amp; Terbitkan Ulang</SubmitButton>
              </form>
            </div>
          )}
        </>
      ) : (
        <PembayaranForm
          visitId={visit.id}
          patient={patient}
          initialObat={initialObat}
          initialJasa={initialJasa}
          catatanResep={mr.catatan_resep}
        />
      )}

      {/* Riwayat perubahan invoice (audit log §7). */}
      {(editLog ?? []).length > 0 && (
        <div className="crm-sec" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 8 }}>
            <i className="ti ti-history" /> RIWAYAT PERUBAHAN INVOICE
          </div>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Waktu</th><th>Oleh</th><th>Field</th><th>Sebelum</th><th>Sesudah</th><th>Alasan</th></tr></thead>
            <tbody>
              {(editLog ?? []).map((l, i) => {
                const editor = one(l.profiles as Rel<{ full_name: string | null }>);
                return (
                  <tr key={i}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{new Date(l.edited_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ fontSize: 10.5 }}>{editor?.full_name ?? "—"}</td>
                    <td><span className={`bge ${l.field_changed === "voided" ? "r" : "o"}`}>{l.field_changed}</span></td>
                    <td style={{ fontSize: 10.5, maxWidth: 180, wordBreak: "break-word" }}>{l.old_value ?? "—"}</td>
                    <td style={{ fontSize: 10.5, maxWidth: 180, wordBreak: "break-word" }}>{l.new_value ?? "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{l.reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
