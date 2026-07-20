import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null { return Array.isArray(r) ? (r[0] ?? null) : r; }
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

function petAge(dob: string | null | undefined): string {
  if (!dob) return "—";
  const d = new Date(dob), now = new Date();
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m--;
  if (m < 0) return "—";
  const y = Math.floor(m / 12), mm = m % 12;
  return y >= 1 ? `${y} Tahun${mm ? ` ${mm} Bln` : ""}` : `${mm} Bulan`;
}

const BLUE = "#1d4ed8";

export default async function DokumenRekamMedisPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, poli, dokter, keluhan, status, created_at, pets(name, species, breed, dob, gender, weight, photo_url), customers(name, phone, address, tier), branches(name)")
    .eq("id", visitId).maybeSingle();
  if (!visit) notFound();
  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const branch = one(visit.branches);

  const { data: mr } = await supabase
    .from("medical_records")
    .select("id, diagnosis, anamnesis, suhu, berat, gejala_klinis, hasil_penunjang, penunjang_urls, follow_up, catatan_resep, created_at")
    .eq("visit_id", visitId).order("created_at", { ascending: false }).limit(1).maybeSingle();

  // Form persetujuan asli — sebelumnya nilai ini hardcoded "Ditandatangani".
  const { data: consentRows } = await supabase
    .from("consents").select("status, tindakan, signer_name, signed_at").eq("visit_id", visitId).order("created_at");
  const consents = (consentRows ?? []) as { status: string; tindakan: string; signer_name: string | null; signed_at: string | null }[];
  const consentSigned = consents.find((c) => c.status === "sudah_ttd") ?? null;

  // Bucket medical-docs privat → butuh signed URL, tidak bisa dipakai langsung.
  const penunjangPaths = ((mr?.penunjang_urls ?? []) as string[]).filter(Boolean);
  let penunjangUrls: string[] = [];
  if (penunjangPaths.length) {
    const { data: signed } = await supabase.storage.from("medical-docs").createSignedUrls(penunjangPaths, 3600);
    penunjangUrls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
  }

  const { data: presc } = mr
    ? await supabase.from("prescription_items").select("nama_obat, qty, satuan, aturan_pakai, jenis").eq("medical_record_id", mr.id).order("created_at")
    : { data: [] as { nama_obat: string; qty: number; satuan: string; aturan_pakai: string | null; jenis: string }[] };
  const obat = (presc ?? []).filter((p) => p.jenis !== "jasa");
  const jasa = (presc ?? []).filter((p) => p.jenis === "jasa");

  const { data: invoice } = await supabase
    .from("invoices").select("metode_bayar, total, paid_status").eq("visit_id", visitId).is("voided_at", null).maybeSingle();

  const { data: inpat } = await supabase
    .from("inpatient_records").select("admitted_at, condition_status").eq("visit_id", visitId).order("admitted_at", { ascending: false });

  const noRM = `RM/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(visit.id as string).slice(0, 3).toUpperCase()}`;
  const tglPeriksa = new Date(visit.created_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const dicetak = new Date(mr?.created_at ?? visit.created_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/rekam-medis/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke rekam medis</Link>
        <PrintButton label="Cetak Rekam Medis" />
      </div>

      <div className="rm-doc" style={{ maxWidth: 900, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", padding: "30px 34px", fontSize: 11.5, color: "#141413" }}>
        {/* ===== Kop ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 260px", gap: 16, alignItems: "flex-start", borderBottom: `2px solid ${BLUE}`, paddingBottom: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: 10, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className="ti ti-paw" style={{ fontSize: 24, color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: BLUE, lineHeight: 1 }}>KAMO PET CARE</div>
              <div style={{ fontSize: 8.5, color: "var(--tm)", letterSpacing: ".08em" }}>WE CARE, THEY DESERVE</div>
            </div>
          </div>
          <div style={{ textAlign: "center", paddingTop: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#141413", letterSpacing: ".01em" }}>REKAM MEDIS PASIEN</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Pemeriksaan oleh Dokter Poli</div>
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
            <tbody>
              <KV k="No. RM" v={noRM} />
              <KV k="Tanggal Periksa" v={tglPeriksa} />
              <KV k="Dokter" v={visit.dokter ?? "—"} />
            </tbody>
          </table>
        </div>

        {/* ===== Pasien ===== */}
        <div style={{ display: "flex", gap: 18, marginBottom: 8 }}>
          <div style={{ width: 108, height: 108, borderRadius: 8, background: "var(--sf1)", border: ".5px solid var(--bd)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {pet?.photo_url ? <img src={pet.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 44, color: "var(--td)" }} />}
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 24px", alignContent: "start" }}>
            <div style={{ gridColumn: "1 / -1", fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{pet?.name ?? "—"} <span style={{ fontWeight: 500, color: "var(--tm)", fontSize: 13 }}>({pet?.species ?? "—"})</span></div>
            <Row label="Pemilik" value={cust?.name} />
            <Row label="Jenis Kelamin" value={pet?.gender} />
            <Row label="No. HP" value={cust?.phone} />
            <Row label="Ras" value={pet?.breed} />
            <Row label="Alamat" value={cust?.address} />
            <Row label="Usia" value={petAge(pet?.dob)} />
            <Row label="" value="" />
            <Row label="Berat Badan" value={pet?.weight != null ? `${pet.weight} kg` : "—"} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, border: ".5px solid var(--bd)", borderRadius: 8, padding: "8px 14px", marginBottom: 16, maxWidth: 380 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tm)" }}>Kategori Pelanggan</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, background: "var(--sf1)", border: ".5px solid var(--bd)", borderRadius: 6, padding: "4px 12px", fontSize: 11.5, fontWeight: 600 }}>
            <i className="ti ti-award" style={{ color: "#9ca3af" }} /> {cust?.tier ?? "—"}
          </span>
        </div>

        {/* ===== 2 kolom ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, borderTop: `1px solid ${BLUE}`, paddingTop: 14 }}>
          {/* KIRI: data klinis */}
          <div>
            <SecTitle icon="ti-clipboard-heart" text="DATA KLINIS" />
            <Clin label="Keluhan" value={visit.keluhan} />
            <Clin label="Anamnesa" value={mr?.anamnesis} />
            <Clin label="Berat Badan" value={mr?.berat ?? pet?.weight ? `${mr?.berat ?? pet?.weight} kg` : null} />
            <Clin label="Suhu Badan" value={mr?.suhu != null ? `${mr.suhu} °C` : null} />
            <Clin label="Gejala Klinis" value={mr?.gejala_klinis} />
            <Clin label="Hasil Pemeriksaan Penunjang" value={mr?.hasil_penunjang} />
            <Clin label="Diagnosa" value={mr?.diagnosis} />
            <Clin label="Form Persetujuan" value={
              consentSigned
                ? <span style={{ color: "#15803d", fontWeight: 600 }}>Ditandatangani{consentSigned.signer_name ? ` — ${consentSigned.signer_name}` : ""}</span>
                : consents.length
                  ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>Belum ditandatangani</span>
                  : <span style={{ color: "var(--tm)" }}>Tidak ada</span>
            } />
            <Clin label="Status" value={visit.status} />

            {penunjangUrls.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <SecTitle icon="ti-photo" text="FOTO HASIL PENUNJANG" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {penunjangUrls.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt={`Hasil penunjang ${i + 1}`}
                      style={{ width: 120, height: 120, objectFit: "cover", border: ".5px solid var(--bd)", borderRadius: 8 }} />
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <SecTitle icon="ti-calendar-event" text="FOLLOW UP" />
              <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 12, minHeight: 60, fontSize: 11, color: mr?.follow_up ? "#141413" : "var(--td)" }}>
                {mr?.follow_up || "Catatan follow up / rencana kontrol berikutnya:"}
              </div>
            </div>
          </div>

          {/* KANAN: tindakan & terapi */}
          <div>
            <SecTitle icon="ti-first-aid-kit" text="RINCIAN TINDAKAN & TERAPI" />
            <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, margin: "4px 0 6px" }}>OBAT YANG DIBERIKAN</div>
            <table className="rm-tbl">
              <thead><tr><th style={{ width: 30 }}>No.</th><th>Nama Obat</th><th>Aturan Pakai</th><th style={{ width: 54 }}>Jumlah</th><th style={{ width: 58 }}>Satuan</th></tr></thead>
              <tbody>
                {obat.map((o, i) => (
                  <tr key={i}><td>{i + 1}.</td><td>{o.nama_obat}</td><td>{o.aturan_pakai ?? "—"}</td><td style={{ textAlign: "center" }}>{o.qty}</td><td>{o.satuan}</td></tr>
                ))}
                {obat.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)" }}>Tidak ada obat.</td></tr>}
              </tbody>
            </table>

            <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, margin: "14px 0 6px" }}>JASA / TINDAKAN</div>
            <table className="rm-tbl">
              <thead><tr><th style={{ width: 30 }}>No.</th><th>Nama Tindakan</th><th>Keterangan</th></tr></thead>
              <tbody>
                {jasa.map((j, i) => (
                  <tr key={i}><td>{i + 1}.</td><td>{j.nama_obat}</td><td>{j.aturan_pakai ?? "—"}</td></tr>
                ))}
                {jasa.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--td)" }}>Tidak ada tindakan.</td></tr>}
              </tbody>
            </table>

            <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 12, marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, marginBottom: 4 }}>CATATAN RESEP</div>
              <div style={{ fontSize: 11, color: "var(--tm)", lineHeight: 1.5 }}>{mr?.catatan_resep || "—"}</div>
            </div>
          </div>
        </div>

        {/* ===== Histori rawat inap + pembayaran ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, borderTop: ".5px dashed var(--bd)", marginTop: 18, paddingTop: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>HISTORI RAWAT INAP</div>
            <table className="rm-tbl">
              <thead><tr><th style={{ width: 110 }}>Tanggal</th><th>Status</th></tr></thead>
              <tbody>
                {(inpat ?? []).map((r, i) => (
                  <tr key={i}><td>{new Date(r.admitted_at).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" })}</td><td style={{ textTransform: "capitalize" }}>{r.condition_status}</td></tr>
                ))}
                {(inpat ?? []).length === 0 && <tr><td>—</td><td style={{ color: "var(--td)" }}>Belum ada riwayat rawat inap.</td></tr>}
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>RINCIAN PEMBAYARAN</div>
            <Row label="Metode Pembayaran" value={invoice?.metode_bayar ?? "-"} />
            <Row label="Total Dibayarkan" value={invoice?.total ? rp(Number(invoice.total)) : "-"} />
            <Row label="Status" value={invoice?.paid_status ?? "Belum Lunas"} />
          </div>
        </div>

        {/* ===== Tanda tangan + info ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr", gap: 20, marginTop: 22, alignItems: "end" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textAlign: "left", marginBottom: 40 }}>TANDA TANGAN</div>
            <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Pemilik</div>
            <div style={{ borderTop: ".5px solid #141413", marginTop: 30, paddingTop: 3, fontSize: 10.5 }}>( {cust?.name ?? "—"} )</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9.5, color: "var(--tm)", marginTop: 12 }}>Dokter Penanggung Jawab</div>
            <div style={{ borderTop: ".5px solid #141413", marginTop: 30, paddingTop: 3, fontSize: 10.5 }}>( {visit.dokter ?? "—"} )</div>
          </div>
          <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 12, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 9.5, flex: 1 }}>
              <div style={{ fontWeight: 800, color: BLUE, marginBottom: 3 }}>INFORMASI KLINIK</div>
              <div style={{ fontWeight: 600 }}>{branch?.name ?? "KAMO PET CARE"}</div>
              <div style={{ color: "var(--tm)" }}>{cust?.phone ? `WA ${cust.phone}` : "Kamo Group"}</div>
            </div>
            <div style={{ width: 58, height: 58, background: "repeating-conic-gradient(#141413 0% 25%, #fff 0% 50%) 50%/8px 8px", border: ".5px solid var(--bd)", flexShrink: 0 }} title="QR Rekam Medis" />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: ".5px solid var(--bd)", marginTop: 18, paddingTop: 8, fontSize: 9.5, color: "var(--tm)" }}>
          <span>Dicetak pada: {dicetak}</span>
          <span>Terima kasih atas kepercayaan Anda <i className="ti ti-paw" /></span>
        </div>
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td style={{ border: ".5px solid var(--bd)", padding: "3px 7px", background: "var(--sf1)", color: "var(--tm)", whiteSpace: "nowrap" }}>{k}</td>
      <td style={{ border: ".5px solid var(--bd)", padding: "3px 7px", fontWeight: 600 }}>{v}</td>
    </tr>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!label) return <div />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, fontSize: 11 }}>
      <span style={{ color: "var(--tm)", minWidth: 96 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
function SecTitle({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
      <i className={`ti ${icon}`} style={{ color: BLUE, fontSize: 15 }} />
      <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, letterSpacing: ".02em" }}>{text}</span>
    </div>
  );
}
function Clin({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, padding: "5px 0", borderBottom: ".5px dotted var(--bd)", fontSize: 11 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
