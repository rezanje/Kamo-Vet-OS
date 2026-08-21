import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { PembayaranForm } from "./PembayaranForm";
import { LunasiRombonganForm } from "./LunasiRombonganForm";
import { getPajakSettings } from "@/lib/pajak";
import { SubmitButton } from "@/components/SubmitButton";
import { voidAndReissue } from "./actions";
import { bolehBayar, kategoriBerisiko } from "@/lib/tindakan";
import { bacaAturanConsent } from "@/lib/consent-server";
import { bacaRombongan } from "@/lib/rombongan-server";
import { perkiraanTagihan, bekalPotonganKlinik, nilaiBaris } from "@/lib/tagihan-klinik";
import { UlasanBadge, type StatusUlasan } from "@/components/UlasanBadge";
import { berikutnyaBelumSelesai, labelStatus, ringkasTagihanRombongan } from "@/lib/rombongan-tagihan";

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
  searchParams: Promise<{ error?: string; success?: string; edit?: string; lunas?: string; dilewati?: string }>;
}) {
  const { visitId } = await params;
  const { error, success, lunas: lunasParam, dilewati } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, status, poli, dokter, created_at, branch_id, customer_id, pets(name, species, weight, photo_url), customers(name, phone, address, review_catatan, customer_review_statuses(nama, warna, nada))")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) notFound();

  // Rekam medis opsional: transaksi walk-in tanpa dokter (grooming, beli obat,
  // retail) masuk lewat "Simpan & pembayaran" di registrasi — langsung ke invoice.
  const { data: mr } = await supabase
    .from("medical_records").select("id, catatan_resep").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  // jenis layanan: rawat inap kalau ada record inpatient, selain itu poli.
  const { data: inpat } = await supabase.from("inpatient_records").select("id").eq("visit_id", visitId).limit(1).maybeSingle();
  const jenisLayanan = inpat ? "Rawat Inap" : visit.poli;

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  // Status ulasan pemilik ditaruh di atas layar bayar: kalau dia pernah kasih
  // bintang 1, kasir klinik tahu sebelum bicara soal uang.
  const ulasanPemilik = one((cust as { customer_review_statuses?: Rel<StatusUlasan> } | null)?.customer_review_statuses ?? null);
  const activeStep = STEP_BY_STATUS[visit.status] ?? 3;

  // Satu pemilik bisa datang membawa beberapa hewan; tagihannya tetap terpisah per
  // kunjungan, tapi kasir perlu melihat semuanya sekaligus supaya tidak ada yang
  // tertinggal dan pemiliknya tidak dipanggil dua kali.
  const rombongan = await bacaRombongan(supabase, visitId);
  const adaRombongan = (rombongan?.baris.length ?? 0) > 1;
  const ringkasan = rombongan ? ringkasTagihanRombongan(rombongan.baris) : null;
  const berikutnya = rombongan ? berikutnyaBelumSelesai(rombongan.baris, visitId) : null;
  const belumDitagih = (rombongan?.baris ?? []).filter((b) => b.invoiceNo === null);

  // invoice AKTIF (belum di-void) — voided tetap tersimpan utk riwayat (Addendum §7).
  const { data: invoice } = await supabase
    .from("invoices").select("id, invoice_no, subtotal, discount, tax, total, dp_amount, dp_date, paid_status, metode_bayar, paid_at, reissued_from, created_at")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();
  const { data: invItems } = invoice
    ? await supabase.from("invoice_items").select("deskripsi, qty, harga, jenis, item_id, diskon_persen").eq("invoice_id", invoice.id).order("created_at")
    : { data: [] as { deskripsi: string; qty: number; harga: number; jenis: string; item_id: string | null; diskon_persen: number }[] };

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
  const { data: resep } = mr
    ? await supabase.from("prescription_items").select("nama_obat, qty, harga, jenis, item_id").eq("medical_record_id", mr.id).order("created_at")
    : { data: [] as { nama_obat: string; qty: number; harga: number; jenis: string; item_id: string | null }[] };
  // item_id ikut dibawa (migrasi 0084): tanpa itu stok obat tidak bisa dipotong
  // saat pasien menebus, dan modalnya tidak pernah tercatat.
  const resepRows = (resep ?? []).map((r) => ({ deskripsi: r.nama_obat, qty: r.qty, harga: Number(r.harga) || 0, jenis: r.jenis ?? "obat", item_id: r.item_id ?? null }));

  // §6.3: tindakan berisiko wajib punya consent bertanda tangan sebelum boleh ditagih.
  const { data: kategoriRows } = mr
    ? await supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mr.id)
    : { data: [] as { jenis: string; kategori: string | null }[] };
  const { data: consentRows } = await supabase.from("consents").select("status").eq("visit_id", visitId);
  const jasaKategori = (kategoriRows ?? []) as { jenis: string; kategori: string | null }[];
  const consentList = (consentRows ?? []) as { status: string }[];
  // Aturan tindakan mana yang wajib berformulir diatur klinik sendiri di layar
  // Form Persetujuan, bukan dikunci di kode.
  const aturanConsent = await bacaAturanConsent(supabase);
  const bolehTagih = bolehBayar(jasaKategori, !!inpat, consentList, aturanConsent);
  const katBerisiko = kategoriBerisiko(jasaKategori, !!inpat, aturanConsent);
  const prefill = resepRows.length
    ? resepRows
    : [{ deskripsi: `Jasa Konsultasi ${visit.poli}`, qty: 1, harga: 0, jenis: "jasa", item_id: null as string | null }];

  // Tarif PPN yang dipakai LAYAR harus sama dengan yang dipakai server saat
  // menyimpan. Mode PKP OFF → 0%, jadi kasir tidak menagih pajak yang tidak
  // pernah tercatat di invoice.
  const pajak = await getPajakSettings(supabase);
  const ppnRate = pajak.mode_pkp ? Number(pajak.ppn_rate) : 0;

  const lunas = invoice?.paid_status === "Lunas";

  // Kasir menyebut angka ke pemilik SEBELUM memilih metode bayar. Kunjungan yang
  // invoicenya belum dibuat tidak punya total tersimpan, jadi dihitung di sini
  // dengan rumus yang sama persis dengan aksi bayar rombongan.
  const perkiraan = await perkiraanTagihan(supabase, belumDitagih.map((b) => b.visitId), pajak);
  const totalAkanDitagih = belumDitagih
    .filter((b) => perkiraan.get(b.visitId)?.bisaDibayar)
    .reduce((a, b) => a + (perkiraan.get(b.visitId)?.total ?? 0), 0);
  const tertahanConsent = belumDitagih.filter((b) => perkiraan.get(b.visitId)?.bisaDibayar === false);

  // Split obat vs jasa dari kolom `jenis` (2 tabel gaya referensi).
  const sourceItems = invoice
    ? (invItems ?? []).map((l) => ({ deskripsi: l.deskripsi, qty: Number(l.qty), harga: Number(l.harga), jenis: l.jenis ?? "obat", item_id: l.item_id ?? null, diskon_persen: Number(l.diskon_persen) || 0 }))
    : prefill;
  const initialObat = sourceItems.filter((r) => r.jenis !== "jasa");
  const initialJasa = sourceItems.filter((r) => r.jenis === "jasa");

  // Baris tambahan di kasir klinik wajib bisa dipilih dari master, bukan diketik
  // bebas: baris tanpa item_id tidak memotong stok dan HPP-nya nol, jadi obat
  // terjual tapi persediaan tidak pernah berkurang.
  const { data: masterRows } = await supabase
    .from("items").select("id, code, name, unit, sell_price, item_type")
    .eq("is_active", true).order("name");
  const master = (masterRows ?? []).map((it) => ({
    id: it.id as string, code: it.code as string, name: it.name as string,
    unit: (it.unit as string) ?? "", harga: Number(it.sell_price) || 0,
    jasa: it.item_type === "Jasa",
  }));
  const masterObat = master.filter((it) => !it.jasa);
  const masterJasa = master.filter((it) => it.jasa);

  // Bahan promo/voucher/diskon golongan untuk layar. Servernya tetap menghitung
  // ulang saat menyimpan — ini supaya kasir melihat angkanya lebih dulu.
  const bekal = await bekalPotonganKlinik(
    supabase, visit.branch_id ?? null, visit.customer_id ?? null, master.map((it) => it.id),
  );

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
      {success === "rombongan" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {lunasParam ?? ""} tagihan diselesaikan sekaligus — cetak struk gabungan di panel bawah.
          {dilewati && <b style={{ marginLeft: 6, color: "#b45309" }}>Belum termasuk: {dilewati} — selesaikan satu per satu.</b>}
        </div>
      )}
      {success === "reissue" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Invoice lama di-void, invoice baru diterbitkan (Belum Lunas).
        </div>
      )}

      {ulasanPemilik && (
        <div className="p2ban" style={{
          background: `color-mix(in srgb, ${ulasanPemilik.warna} 8%, transparent)`,
          border: `.5px solid color-mix(in srgb, ${ulasanPemilik.warna} 35%, transparent)`,
          color: ulasanPemilik.warna,
        }}>
          <UlasanBadge s={ulasanPemilik} />
          <span style={{ marginLeft: 8, color: "var(--tm)" }}>
            {cust?.review_catatan ?? "Status ulasan pemilik — layani dengan perhatian lebih."}
          </span>
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

      {/* Pasien (hanya di tampilan read-only invoice lunas; form editable punya header sendiri) */}
      {invoice && lunas && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 28px" }}>
            <Field label="Pasien" value={`${pet?.name ?? "—"} · ${pet?.species ?? ""}`} />
            <Field label="Pemilik" value={`${cust?.name ?? "—"} · ${cust?.phone ?? ""}`} />
            <Field label="Poli" value={visit.poli} />
            {visit.dokter && <Field label="Dokter" value={visit.dokter} />}
          </div>
        </div>
      )}


      {/* Panel rombongan: muncul hanya kalau pemilik ini memang bawa lebih dari satu hewan. */}
      {adaRombongan && rombongan && ringkasan && (
        <div className="card" style={{ marginBottom: 12, borderColor: "#bfdbfe", background: "#f8fbff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e40af" }}>
              <i className="ti ti-paw" /> {rombongan.customerName} membawa {ringkasan.jumlahPasien} pasien hari ini
            </div>
            <div style={{ fontSize: 11, color: "var(--tm)" }}>
              Total {rp(ringkasan.totalTagihan + totalAkanDitagih)} · sisa <b style={{ color: ringkasan.sisa + totalAkanDitagih > 0 ? "#b91c1c" : "#15803d" }}>{rp(ringkasan.sisa + totalAkanDitagih)}</b>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>Pasien</th><th>No. Tagihan</th><th style={{ textAlign: "right" }}>Total</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rombongan.baris.map((b) => (
                  <tr key={b.visitId} style={{ background: b.visitId === visitId ? "#eff6ff" : undefined }}>
                    <td style={{ fontSize: 11.5, fontWeight: b.visitId === visitId ? 700 : 500 }}>
                      {b.hewan}{b.visitId === visitId ? " · sedang dibuka" : ""}
                    </td>
                    <td style={{ fontSize: 10.5, fontFamily: "monospace", color: "var(--tm)" }}>{b.invoiceNo ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>
                      {b.invoiceNo === null && perkiraan.has(b.visitId) ? (
                        <>
                          {rp(perkiraan.get(b.visitId)!.total)}
                          <div style={{ fontSize: 9.5, color: "var(--td)" }}>perkiraan</div>
                        </>
                      ) : rp(b.total)}
                    </td>
                    <td><span className={`bge ${b.paidStatus === "Lunas" ? "g" : b.invoiceNo === null ? "" : "r"}`}>{labelStatus(b)}</span></td>
                    <td>
                      {b.visitId !== visitId && (
                        <Link href={`/klinik/pembayaran/${b.visitId}`} className="btn-def"
                          style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Buka</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sekali bayar untuk semua hewan: pemilik tidak dipanggil berkali-kali.
              Hanya untuk kunjungan yang tagihannya belum dibuat — yang sudah punya
              invoice (DP/sebagian bayar) punya jalur pelunasan sendiri. */}
          {belumDitagih.length >= 2 && (
            <LunasiRombonganForm
              visitId={visitId}
              jumlahPasien={belumDitagih.length - tertahanConsent.length}
              total={totalAkanDitagih}
              tertahan={tertahanConsent.map((b) => b.hewan)}
              bekal={bekal}
            />
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
            {berikutnya && (
              <Link href={`/klinik/pembayaran/${berikutnya.visitId}`} className="btn-acc"
                style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
                Lanjut ke {berikutnya.hewan} <i className="ti ti-arrow-right" />
              </Link>
            )}
            <Link href={`/klinik/pembayaran/${visitId}/struk-rombongan`} className="btn-def"
              style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
              <i className="ti ti-receipt" /> Struk gabungan
            </Link>
            {ringkasan.adaBelumDitagih && (
              <span style={{ fontSize: 10, color: "#b45309", alignSelf: "center" }}>
                <i className="ti ti-alert-triangle" /> Ada pasien yang tagihannya belum dibuat.
              </span>
            )}
          </div>
        </div>
      )}

      {!bolehTagih && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <i className="ti ti-file-alert" /> Pembayaran diblokir — tindakan {katBerisiko.join(", ")} wajib form persetujuan yang sudah ditandatangani.
          </span>
          <Link href={`/klinik/rekam-medis/${visit.id}`} className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
            Buat / Tanda Tangani
          </Link>
        </div>
      )}

      {!bolehTagih ? null : invoice && !lunas ? (
        <PembayaranForm
          visitId={visit.id}
          patient={patient}
          ppnRate={ppnRate}
          initialObat={initialObat}
          initialJasa={initialJasa}
          masterObat={masterObat}
          masterJasa={masterJasa}
          bekal={bekal}
          catatanResep={mr?.catatan_resep ?? null}
          initialDiscount={Number(invoice.discount)}
          initialDpAmount={Number(invoice.dp_amount)}
          initialDpDate={invoice.dp_date}
          editMode
        />
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
              <thead><tr><th>Item</th><th style={{ textAlign: "center" }}>Qty</th><th style={{ textAlign: "right" }}>Harga</th><th style={{ textAlign: "center" }}>Disk %</th><th style={{ textAlign: "right" }}>Subtotal</th></tr></thead>
              <tbody>
                {(invItems ?? []).map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{l.deskripsi}</td>
                    <td style={{ textAlign: "center" }}>{l.qty}</td>
                    <td style={{ textAlign: "right" }}>{rp(l.harga)}</td>
                    <td style={{ textAlign: "center" }}>{Number(l.diskon_persen) > 0 ? `${Number(l.diskon_persen)}%` : "—"}</td>
                    <td style={{ textAlign: "right" }}>{rp(nilaiBaris(l))}</td>
                  </tr>
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
          ppnRate={ppnRate}
          initialObat={initialObat}
          initialJasa={initialJasa}
          masterObat={masterObat}
          masterJasa={masterJasa}
          bekal={bekal}
          catatanResep={mr?.catatan_resep ?? null}
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
