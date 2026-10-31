import { admitInpatient } from "../../rawat-inap/actions";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { STAY_TYPES, STAY_TYPE_LABEL } from "@/lib/inpatient-stay";
import { loadBranchGroomingPolicy, loadServiceStaff, loggedInCashier } from "@/lib/service-performers-server";
import { servicePerformerNames, type ServicePerformersSnapshot } from "@/lib/service-performers";
import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { Popup } from "@/components/Popup";
import { readDemoPolicy } from "@/lib/clinic-demo-policy-server";
import { VoidReissueForm } from "./VoidReissueForm";
import { ClinicRefundPanel, loadClinicRefundData } from "./ClinicRefundPanel";
import { loadClinicPackages, loadClinicPaymentMaster } from "@/lib/clinic-payment";
import { randomUUID, createHash } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { PaymentPageHeading } from "./PaymentPresentation";
import { PembayaranForm } from "./PembayaranForm";
import { InpatientPaymentPage } from "./InpatientPaymentPage";
import { LunasiRombonganForm } from "./LunasiRombonganForm";
import { PelunasanTagihanForm } from "./PelunasanTagihanForm";
import { sisaTagihan } from "@/lib/pelunasan-klinik";
import { getPajakSettings } from "@/lib/pajak";
import { getDpMinimalPercent, bolehMenerobosDp } from "@/lib/dp-minimal";
import { bolehSiklusTagihan } from "@/lib/uang-tagihan";
import { bolehBayar, kategoriBerisiko } from "@/lib/tindakan";
import { bacaAturanConsent } from "@/lib/consent-server";
import { bacaRombongan } from "@/lib/rombongan-server";
import { perkiraanTagihan, bekalPotonganKlinik, nilaiBaris } from "@/lib/tagihan-klinik";
import { UlasanBadge, type StatusUlasan } from "@/components/UlasanBadge";
import { berikutnyaBelumSelesai, labelStatus, ringkasTagihanRombongan } from "@/lib/rombongan-tagihan";
import { mulai } from "@/lib/u07-waktu";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const unverifiedBilling = () => new Error("Tagihan belum dapat diverifikasi. Muat ulang sebelum memproses pembayaran.");
/** Versi keranjang dari database; null hanya bila database belum punya fungsinya (sebelum migrasi). */
function versiKeranjang(baru: boolean, { data, error }: { data: unknown; error: { code?: string; message?: string } | null }): string | null {
  if (!baru) return null;
  if (error?.code === "PGRST202" && error.message?.includes("clinic_outpatient_cart_version")) return null;
  if (error || typeof data !== "string" || !/^v1:[0-9a-f]{32}$/.test(data)) throw unverifiedBilling();
  return data;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const STEPS = ["Pendaftaran", "Antrian", "Rekam Medis", "Pembayaran"];
const STEP_BY_STATUS: Record<string, number> = { Menunggu: 1, Diperiksa: 2, Pembayaran: 3, Selesai: 4 };

export default async function PembayaranPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ error?: string; success?: string; edit?: string; lunas?: string; dilewati?: string; rawatinap?: string;invoice?:string;receipt?:string;applications?:string;invoice_id?:string }>;
}) {
  const { visitId } = await params;
  const query = await searchParams;
  const { error, success, lunas: lunasParam, dilewati, rawatinap } = query;
  const invoiceRequestKey = randomUUID();
  const groupRequestKey = randomUUID();
  const supabase = await createClient();
  // Klinik-A: bacaan yang cuma butuh visitId dimulai bersamaan. Tiap hasil tetap
  // ditunggu & diperiksa di posisi lamanya (helper `mulai`), jadi urutan validasi,
  // notFound, dan pesan galat tidak berubah.
  const userP = mulai(supabase.auth.getUser());
  const visitP = mulai(supabase
    .from("visits")
    .select("id, status, poli, dokter, created_at, branch_id, customer_id, doctor_id, service_provider_id, pets(name, species, weight, photo_url), customers(name, phone, address, review_catatan, customer_review_statuses(nama, warna, nada))")
    .eq("id", visitId)
    .maybeSingle());
  // Rekam medis opsional: transaksi walk-in tanpa dokter (grooming, beli obat,
  // retail) masuk lewat "Simpan & pembayaran" di registrasi — langsung ke invoice.
  const mrP = mulai(supabase
    .from("medical_records").select("id, catatan_resep").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle());
  // jenis layanan: rawat inap kalau ada record inpatient, selain itu poli.
  const inpatP = mulai(supabase.from("inpatient_records").select("id,consent_id,discharged_at").eq("visit_id", visitId).order("created_at", { ascending: false }).limit(1).maybeSingle());
  const { data: { user: draftUser } } = await userP;

  const { data: visit } = await visitP;
  if (!visit) notFound();

  const { data: mr, error: mrError } = await mrP;

  if (mrError) throw unverifiedBilling();

  // G: racikan yang masih "Menunggu diracik" tidak menghalangi pembayaran, tapi kasir
  // harus mengkonfirmasi dulu supaya obatnya tidak ikut tertinggal saat pemilik pulang.
  const racikanPendingP = mr
    ? mulai(supabase.from("compounding_recipes").select("id").eq("medical_record_id", mr.id).eq("status", "pending").limit(1))
    : Promise.resolve({ data: [] as { id: string }[], error: null });
  const { data: inpat, error: inpatientError } = await inpatP;
  const linkedP = !inpatientError && inpat?.consent_id ? mulai(supabase.rpc("clinic_inpatient_consent_valid", {p_visit_id:visitId})) : null;
  // Klinik-A: bacaan khusus rawat jalan dimulai sekarang (pasien rawat inap pindah ke
  // layar kasir rawat inap di bawah dan tidak memakainya).
  const outpatient = !inpatientError && !(inpat && !query.invoice_id);
  const rombonganP = outpatient ? mulai(bacaRombongan(supabase, visitId)) : null;
  const invoiceRowsP = outpatient ? mulai(supabase
    .from("invoices").select("id, invoice_no, subtotal, discount, tax, total, dp_amount, dp_date, paid_status, metode_bayar, paid_at, reissued_from, correction_pending, created_at, request_key, salesperson_id, cashier_name, service_pricing_version")
    .eq("visit_id", visitId).is("voided_at", null)
    .order("created_at", { ascending: true }).order("id", { ascending: true })) : null;
  const allInvIdsP = outpatient ? mulai(supabase.from("invoices").select("id, invoice_no").eq("visit_id", visitId)) : null;
  // Satu bacaan resep untuk baris tagihan DAN kategori consent (dulu dibaca dua kali).
  const resepP = outpatient && mr ? mulai(supabase.from("prescription_items").select("id, nama_obat, qty, harga, jenis, kategori, item_id, satuan, compound_recipe_id, service_performers, salesperson_id, salesperson_name").eq("medical_record_id", mr.id).order("created_at")) : null;
  const consentRowsP = outpatient ? mulai(supabase.from("consents").select("status").eq("visit_id", visitId)) : null;
  const aturanConsentP = outpatient ? mulai(bacaAturanConsent(supabase)) : null;
  const pajakP = outpatient ? mulai(getPajakSettings(supabase)) : null;
  const dpP = outpatient ? mulai(Promise.all([
    getDpMinimalPercent(supabase),
    draftUser ? supabase.from("profiles").select("role").eq("id", draftUser.id).maybeSingle() : Promise.resolve({ data: null }),
  ])) : null;
  const unitCapabilityP = outpatient ? mulai(supabase.rpc("clinic_manual_invoice_units_supported")) : null;
  const groomingPolicyP = outpatient && visit.branch_id ? mulai(loadBranchGroomingPolicy(supabase, visit.branch_id)) : null;
  // Gerbang shift tetap diperiksa di posisi lamanya (hanya bila belum lunas); di sini cuma dibaca lebih awal.
  const shiftP = outpatient && draftUser ? mulai(getOpenShift(supabase as never, draftUser.id, "klinik")) : null;

  const { data: racikanPendingRows, error: racikanPendingError } = await racikanPendingP;
  if (racikanPendingError) throw unverifiedBilling();
  const racikanPending = (racikanPendingRows ?? []).length > 0;

  if (inpatientError) throw unverifiedBilling();
  if (linkedP) {
    const linked = await linkedP;
    if (linked.error || linked.data !== true) throw new Error("Persetujuan khusus rawat inap tidak valid. Periksa rekam medis sebelum membayar.");
  }
  const jenisLayanan = inpat ? "Rawat Inap" : visit.poli;
  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const patient = {
    photo: pet?.photo_url ?? null,
    name: pet?.name ?? "—",
    species: pet?.species ?? "—",
    owner: cust?.name ?? "—",
    phone: cust?.phone ?? "—",
    address: cust?.address ?? "—",
    dokter: visit.dokter ?? "—",
    jenisLayanan,
    noInvoice: "(baru)",
    tanggal: new Date(visit.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
  if (inpat && !query.invoice_id) return InpatientPaymentPage({db:supabase,visitId,recordId:inpat.id,branchId:visit.branch_id,userId:draftUser?.id??"",query,
    patient,catatanResep:mr?.catatan_resep??null,stayStatus:inpat.discharged_at?"Sudah pulang":"Masih dirawat"});

  // Status ulasan pemilik ditaruh di atas layar bayar: kalau dia pernah kasih
  // bintang 1, kasir klinik tahu sebelum bicara soal uang.
  const ulasanPemilik = one((cust as { customer_review_statuses?: Rel<StatusUlasan> } | null)?.customer_review_statuses ?? null);
  const activeStep = STEP_BY_STATUS[visit.status] ?? 3;

  // invoice AKTIF (belum di-void) — voided tetap tersimpan utk riwayat (Addendum §7).
  //
  // Rawat inap ditagih BERTAHAP sejak 29 Oktober 2026, jadi satu kunjungan bisa punya
  // beberapa invoice aktif. `maybeSingle()` dulu berubah jadi galat begitu tahap kedua
  // terbit, dan seluruh layar pembayaran mati. Layar ini menangani tagihan TERBARU;
  // pengelolaan tahapnya ada di layar Tagihan rawat inap berjalan.
  const { data: invoiceRows, error: invoiceError } = await invoiceRowsP!;
  if (invoiceError) throw unverifiedBilling();
  const invoiceAktif = invoiceRows ?? [];
  const invoice = query.invoice_id ? invoiceAktif.find(row=>row.id===query.invoice_id) ?? null : invoiceAktif.length ? invoiceAktif[invoiceAktif.length - 1] : null;
  if (query.invoice_id && !invoice) notFound();
  const tagihanBertahap = invoiceAktif.length > 1;
  // Klinik-A: katalog Barang & Jasa (±3.600 SKU + stok/satuan/harga) dan bekal promo
  // hanya dipakai keranjang yang bisa diubah (tagihan baru / koreksi) dan panel bayar
  // rombongan. Tagihan baru pasti memakainya, jadi langsung dimuat; tagihan tersimpan
  // menunggu hasil cek koreksi & rombongan di bawah. Tampilan tagihan terkunci —
  // termasuk layar sesudah "Bayar & Selesai" — tidak memuatnya.
  const startMaster = () => mulai(loadClinicPaymentMaster(supabase, visit.branch_id ?? null));
  let masterP = invoice ? null : startMaster();
  let serviceStaffP = invoice ? null : mulai(loadServiceStaff(supabase, visit.branch_id ?? null));
  // Klinik-A: bacaan yang hanya butuh invoice terpilih ikut berangkat bersama cek DEMO/koreksi.
  const invItemsP = invoice ? mulai(supabase.from("invoice_items").select("id, deskripsi, qty, harga, jenis, item_id, diskon_persen, compound_recipe_id, prescription_item_id, satuan, service_performers, salesperson_id, salesperson_name").eq("invoice_id", invoice.id).order("created_at")) : null;
  const paymentRowsP = invoice ? mulai(supabase.from("invoice_payments").select("amount, transferred_from").eq("invoice_id", invoice.id)) : null;
  const refundDataP = invoice && invoice.paid_status === "Lunas" && !invoice.correction_pending ? mulai(loadClinicRefundData(supabase, invoice.id)) : null;
  const invoiceSalespersonP = invoice?.salesperson_id ? mulai(supabase.from("employees").select("nama").eq("id",invoice.salesperson_id).maybeSingle()) : null;
  const clinicPackagesP = invoice ? null : mulai(loadClinicPackages(supabase));
  const cashierP = !invoice && draftUser ? mulai(loggedInCashier(supabase, draftUser.id, visit.branch_id ?? null)) : null;
  const editLogP = mulai(allInvIdsP!.then(async ({ data: allInvIds }) => (allInvIds ?? []).length
    ? await supabase
        .from("invoice_edit_log")
        .select("field_changed, old_value, new_value, reason, edited_at, invoice_id, profiles(full_name)")
        .in("invoice_id", (allInvIds ?? []).map((x) => x.id))
        .order("edited_at", { ascending: false })
    : { data: [] }));
  const [demoPolicy, demoStaffResult, demoSnapshotResult, koreksiBolehResult, cartVersionResult] = await Promise.all([
    !invoice ? readDemoPolicy(supabase) : Promise.resolve(null),
    !invoice ? supabase.rpc("clinic_demo_care_staff", {p_visit_id:visitId}) : Promise.resolve({data:[],error:null}),
    invoice ? supabase.from("clinic_demo_invoice_snapshots").select("fee_bearer,fee_amount,payments,incentive_pool").eq("invoice_id",invoice.id).maybeSingle() : Promise.resolve({data:null,error:null}),
    // Boleh-tidaknya tagihan ini dikoreksi DIPUTUSKAN DI BASIS DATA, bukan ditebak
    // di layar: aturannya sama persis dengan penjaga tulis (peran, uang di baris
    // pembayaran MAUPUN di kepala tagihan, riwayat yang sudah dibalik seluruhnya,
    // cabang, DEMO, tagihan batal). Tebakan lama di layar ini menolak keadaan yang
    // justru diterima RPC-nya, sehingga koreksi sesudah pembatalan kwitansi mentok.
    invoice ? supabase.rpc("clinic_invoice_correction_eligible", {p_invoice_id:invoice.id}) : Promise.resolve({data:false,error:null}),
    // Versi keranjang rawat jalan dibaca SEBELUM baris resep: kalau dokter menambah item
    // di antaranya, server menolak (CART_STALE) alih-alih menerima keranjang tanpa item itu.
    !invoice ? supabase.rpc("clinic_outpatient_cart_version", {p_visit_id:visitId}) : Promise.resolve({data:null,error:null}),
  ]);
  const cartVersion = versiKeranjang(!invoice, cartVersionResult);
  if (demoStaffResult.error || demoSnapshotResult.error) throw new Error("Rincian aturan DEMO gagal dibaca. Muat ulang sebelum membayar.");
  const demoSnapshot = demoSnapshotResult.data;
  const { data: invItems, error: itemsError } = invItemsP
    ? await invItemsP
    : { error: null, data: [] as { id?: string; deskripsi: string; qty: number; harga: number; jenis: string; item_id: string | null; diskon_persen: number; compound_recipe_id: string | null; prescription_item_id: string | null; satuan: string | null; service_performers?: ServicePerformersSnapshot | null; salesperson_id?: string | null; salesperson_name?: string | null }[] };
  const { data: paymentRows, error: paymentsError } = paymentRowsP
    ? await paymentRowsP
    : { error: null, data: [] as { amount: number; transferred_from: string | null }[] };
  if (itemsError || paymentsError) throw unverifiedBilling();
  const creditAmount = (paymentRows ?? []).filter((p) => p.transferred_from)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const paidAmount = Number(invoice?.dp_amount ?? 0) + (paymentRows ?? [])
    .reduce((sum, p) => sum + Number(p.amount), 0);
  // Gagal membaca kelayakan = form koreksi tidak ditawarkan (bukan layar mati):
  // kasir tetap bisa menerima pembayaran, dan tidak ada koreksi yang dijanjikan
  // lalu ditolak server. Nilai ini BUKAN otorisasi — RPC koreksinya memeriksa
  // ulang peran dan mengunci barisnya sendiri sebelum menyentuh uang.
  const canEdit = Boolean(invoice) && !demoSnapshot && koreksiBolehResult.data === true;
  if (canEdit) serviceStaffP ??= mulai(loadServiceStaff(supabase, visit.branch_id ?? null));

  // Satu pemilik bisa datang membawa beberapa hewan; tagihannya tetap terpisah per
  // kunjungan, tapi kasir perlu melihat semuanya sekaligus supaya tidak ada yang
  // tertinggal dan pemiliknya tidak dipanggil dua kali.
  const rombongan = await rombonganP!;
  const adaRombongan = (rombongan?.baris.length ?? 0) > 1;
  const ringkasan = rombongan ? ringkasTagihanRombongan(rombongan.baris) : null;
  const berikutnya = rombongan ? berikutnyaBelumSelesai(rombongan.baris, visitId) : null;
  const belumDitagih = (rombongan?.baris ?? []).filter((b) => b.invoiceNo === null);

  // Perkiraan tagihan hewan lain hanya tampil di panel rombongan (≥2 hewan).
  const perkiraanP = adaRombongan ? mulai(pajakP!.then((pajak) => perkiraanTagihan(supabase, belumDitagih.map((b) => b.visitId), pajak))) : null;
  if (canEdit || belumDitagih.length >= 2) masterP ??= startMaster();
  const bekalP = masterP ? mulai(masterP.then((m) => bekalPotonganKlinik(
    supabase, visit.branch_id ?? null, visit.customer_id ?? null, m.all.map((it) => it.id),
  ))) : null;

  // riwayat audit: log invoice aktif + log invoice lama (voided) utk visit ini.
  const { data: editLog } = await editLogP;

  // prefill item dari resep saat belum bayar: harga sudah diisi dokter di POS rekam medis
  // (kasir tetap boleh edit). Fallback jasa konsultasi kalau dokter tak input item apa pun.
  const { data: resep, error: prescriptionError } = resepP
    ? await resepP
    : { error: null, data: [] as { id: string; nama_obat: string; qty: number; harga: number; jenis: string; kategori: string | null; item_id: string | null; satuan: string | null; compound_recipe_id: string | null; service_performers?: ServicePerformersSnapshot | null; salesperson_id?: string | null; salesperson_name?: string | null }[] };
  if (prescriptionError) throw unverifiedBilling();
  // item_id ikut dibawa (migrasi 0084): tanpa itu stok obat tidak bisa dipotong
  // saat pasien menebus, dan modalnya tidak pernah tercatat.
  const resepRows = (resep ?? []).map((r) => ({
    deskripsi: r.nama_obat, qty: r.qty, harga: Number(r.harga) || 0,
    jenis: r.jenis ?? "obat", item_id: r.item_id ?? null, satuan: r.satuan ?? null,
    prescription_item_id: r.id, recipe_id: r.compound_recipe_id ?? null,
    ...(r.salesperson_id ? {salesperson_id:r.salesperson_id, salesperson_name:r.salesperson_name ?? null} : {}),
    ...(r.service_performers != null ? {service_performers:r.service_performers} : {}),
  }));

  // §6.3: tindakan berisiko wajib punya consent bertanda tangan sebelum boleh ditagih.
  // Klinik-A: baris resep yang sama (sudah dibaca di atas), bukan bacaan kedua.
  const kategoriRows = (resep ?? []).map((r) => ({ jenis: r.jenis, kategori: r.kategori }));
  const { data: consentRows } = await consentRowsP!;
  const jasaKategori = kategoriRows as { jenis: string; kategori: string | null }[];
  const consentList = (consentRows ?? []) as { status: string }[];
  // Aturan tindakan mana yang wajib berformulir diatur klinik sendiri di layar
  // Form Persetujuan, bukan dikunci di kode.
  const aturanConsent = await aturanConsentP!;
  const bolehTagih = bolehBayar(jasaKategori, !!inpat, consentList, aturanConsent);
  const katBerisiko = kategoriBerisiko(jasaKategori, !!inpat, aturanConsent);
  const prefill = resepRows.length
    ? resepRows
    : [{ deskripsi: `Jasa Konsultasi ${visit.poli}`, qty: 1, harga: 0, jenis: "jasa", item_id: null as string | null }];

  // Tarif PPN yang dipakai LAYAR harus sama dengan yang dipakai server saat
  // menyimpan. Mode PKP OFF → 0%, jadi kasir tidak menagih pajak yang tidak
  // pernah tercatat di invoice.
  const pajak = await pajakP!;
  const ppnRate = pajak.mode_pkp ? Number(pajak.ppn_rate) : 0;
  // Uang muka minimal berlaku untuk SEMUA tagihan klinik (Andri, 29 Oktober 2026).
  const [minDpPercent, { data: profilKasir }] = await dpP!;
  const bolehTerobosDp = bolehMenerobosDp((profilKasir as { role?: string } | null)?.role);
  // Batalkan + terbitkan ulang adalah pekerjaan keuangan (ditegakkan di database);
  // layar tidak menawarkannya ke peran lain supaya tidak menabrak penolakan.
  const bolehTerbitUlang = bolehSiklusTagihan((profilKasir as { role?: string } | null)?.role);

  const lunas = invoice?.paid_status === "Lunas";
  // Pelunasan DP/Belum Lunas rawat jalan oleh kasir klinik: invoice sama, laci shift sendiri.
  const sisaPelunasan = invoice ? sisaTagihan(Number(invoice.total), paidAmount) : 0;
  const pelunasanTerbuka = !inpat && !!invoice && !lunas && !invoice.correction_pending && sisaPelunasan > 0;
  const refundData = refundDataP ? await refundDataP : null;

  // Kasir menyebut angka ke pemilik SEBELUM memilih metode bayar. Kunjungan yang
  // invoicenya belum dibuat tidak punya total tersimpan, jadi dihitung di sini
  // dengan rumus yang sama persis dengan aksi bayar rombongan.
  const perkiraan: Awaited<ReturnType<typeof perkiraanTagihan>> = perkiraanP ? await perkiraanP : new Map();
  const totalAkanDitagih = belumDitagih
    .filter((b) => perkiraan.get(b.visitId)?.bisaDibayar)
    .reduce((a, b) => a + (perkiraan.get(b.visitId)?.total ?? 0), 0);
  const tertahanConsent = belumDitagih.filter((b) => perkiraan.get(b.visitId)?.bisaDibayar === false);

  // Split obat vs jasa dari kolom `jenis` (2 tabel gaya referensi).
  const sourceItems = invoice
    ? (invItems ?? []).map((l) => ({
        deskripsi: l.deskripsi, qty: Number(l.qty), harga: Number(l.harga),
        jenis: l.jenis ?? "obat", item_id: l.item_id ?? null, satuan: l.satuan ?? null,
        prescription_item_id: l.prescription_item_id ?? null, recipe_id: l.compound_recipe_id ?? null,
        ...(l.id ? {source_invoice_item_id:l.id} : {}),
        salesperson_id:l.salesperson_id ?? null, salesperson_name:l.salesperson_name ?? null,
        diskon_persen: Number(l.diskon_persen) || 0,
        ...(l.service_performers != null ? {service_performers:l.service_performers} : {}),
      }))
    : prefill;
  // Tarif rawat inap sekarang MANUAL (keputusan Andri, 29 Oktober 2026): staf memilih
  // jasa rawat inapnya dan mengetik sendiri jumlah hari yang mau ditagih pada tahap ini.
  // Kunci qty otomatis dari lama inap (keputusan Aldi, 19 Agustus) dicabut — sistem tidak
  // lagi menghitung hari sendiri. Dukungan `terkunci` di form sengaja dibiarkan supaya
  // draf lama yang tersimpan di peramban tetap terbuka tanpa error.
  const sourceVersion = cartVersion ?? createHash("sha256").update(JSON.stringify(sourceItems)).digest("hex");
  const initialObat = sourceItems.filter((r) => r.jenis !== "jasa");
  const initialJasa = sourceItems.filter((r) => r.jenis === "jasa");

  // Baris tambahan di kasir klinik wajib bisa dipilih dari master, bukan diketik
  // bebas: baris tanpa item_id tidak memotong stok dan HPP-nya nol, jadi obat
  // terjual tapi persediaan tidak pernah berkurang.
  const { obat: masterObat, jasa: masterJasa } = masterP ? await masterP : { obat: [], jasa: [] };
  const clinicPackages = clinicPackagesP ? await clinicPackagesP : [];
  const serviceStaff = serviceStaffP ? await serviceStaffP : [];
  const groomingPolicy = groomingPolicyP ? await groomingPolicyP : null;
  const groomingDoctorRequired = groomingPolicy?.doctorRequired ?? false;
  const cashier = invoice ? {name:invoice.cashier_name ?? "Kasir belum tercatat"} : cashierP ? await cashierP : {name:"Akun kasir"};
  // Older databases retain their base-unit-only invoice posting contract.
  const unitCapability = await unitCapabilityP!;
  const manualUnitsEnabled = !unitCapability.error && unitCapability.data === true;
  const { data: invoiceSalesperson } = invoiceSalespersonP
    ? await invoiceSalespersonP
    : { data: null };
  const sealedSalespersonName = invoiceSalesperson?.nama ?? "Tanpa penjual";

  // Bahan promo/voucher/diskon golongan untuk layar. Servernya tetap menghitung
  // ulang saat menyimpan — ini supaya kasir melihat angkanya lebih dulu.
  const bekal = bekalP ? await bekalP : null;
  // Semua tempat yang merender `bekal` (keranjang baru/koreksi, bayar rombongan) masuk `perluKatalog`.
  const bekalForm = () => { if (!bekal) throw unverifiedBilling(); return bekal; };

  const invoicePatient = { ...patient, noInvoice: invoice?.invoice_no ?? "(baru)",
    tanggal: new Date((invoice?.created_at as string) ?? visit.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };

  // Addendum §1: pembayaran klinik hanya bisa saat shift klinik terbuka (gate server-side).
  if (!lunas) {
    // Akun yang sama dengan bacaan sesi di atas (dulu dibaca ulang ke server Auth).
    const shift = shiftP ? await shiftP : null;
    if (!shift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);
  }

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik/antrian" className="back-btn"><i className="ti ti-arrow-left" /> Antrian</Link>
      </div>
      <PaymentPageHeading />

      <Popup message={error} />
      <Popup tone="success" title="Pembayaran berhasil"
        message={!error && success === "bayar" && invoice?.paid_status === "Lunas" && visit.status === "Selesai" ? `Invoice ${invoice.invoice_no ?? ""} lunas. Cetak invoice untuk pelanggan.` : null}
        action={invoice ? { href: `/klinik/pembayaran/${visit.id}/invoice?invoice_id=${invoice.id}`, label: "Cetak Invoice", icon: "ti-printer" } : undefined} />
      {!invoice && <div className="p2ban" role="status">Draf tagihan kunjungan ini belum menjadi invoice tersimpan dan belum tercatat sebagai pembayaran atau penjualan.</div>}
      {tagihanBertahap && (
        <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "var(--posb-dk)", justifyContent: "space-between" }}>
          <span>
            <i className="ti ti-stack-2" /> Kunjungan ini ditagih bertahap ({invoiceAktif.length} tagihan aktif).
            Panel di bawah — termasuk koreksi, terbit ulang, dan refund — bekerja pada tagihan
            <b> {invoice?.invoice_no ?? "terakhir"}</b> saja, bukan tahap yang lain.
            Seluruh tahap, riwayat pembayaran, dan sisa piutang ada di layar tagihan rawat inap.
          </span>

        </div>
      )}
      {!error && success === "bayar" && invoice && invoice.paid_status !== "Lunas" && <div className="p2ban" role="status">Invoice tersimpan. Status {invoice.paid_status}; pembayaran belum lunas. Lanjutkan pelunasan melalui tagihan yang sama.</div>}
      {invoice?.paid_status === "Lunas" && visit.status !== "Selesai" && <div className="p2ban" role="alert">Pembayaran sudah tercatat, tetapi status kunjungan belum selesai. Jangan menerima pembayaran ulang; periksa penyelesaian kunjungan.</div>}
      {!error && success === "edit" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Invoice diperbarui — perubahan tercatat di riwayat audit.
        </div>
      )}
      {!error && success === "rombongan" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {lunasParam ?? ""} tagihan diselesaikan sekaligus — cetak struk gabungan di panel bawah.
          {dilewati && <b style={{ marginLeft: 6, color: "#b45309" }}>Belum termasuk: {dilewati} — selesaikan satu per satu.</b>}
        </div>
      )}
      {!error && success === "reissue" && (
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
            <Field label="Penjual historis" value={sealedSalespersonName} />
            <Field label="Kasir" value={invoice.cashier_name ?? "Kasir belum tercatat"} />
            {visit.dokter && <Field label="Dokter" value={visit.dokter} />}
          </div>
        </div>
      )}


      {/* Panel rombongan: muncul hanya kalau pemilik ini memang bawa lebih dari satu hewan. */}
      {adaRombongan && rombongan && ringkasan && (
        <div className="card" style={{ marginBottom: 12, borderColor: "#bfdbfe", background: "#f8fbff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--posb-dk)" }}>
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
                    <td style={{ fontSize: 10.5, fontFamily: "monospace", color: "var(--tm)" }}>
                      {b.invoiceNo ?? "—"}
                      {(b.invoiceNos?.length ?? 0) > 1 && <div style={{ fontSize: 9 }}>+{(b.invoiceNos?.length ?? 1) - 1} tahap lain</div>}
                    </td>
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
            <LunasiRombonganForm key={`${visitId}:${rombongan.customerId ?? ""}:${rombongan.baris.map(b=>b.visitId).sort().join(",")}`}
              contextKey={createHash("sha256").update(`${rombongan.customerId ?? ""}:${rombongan.baris.map(b=>b.visitId).sort().join(",")}`).digest("hex")}
              visitId={visitId}
              requestKey={groupRequestKey}
              jumlahPasien={belumDitagih.length - tertahanConsent.length}
              total={totalAkanDitagih}
              tertahan={tertahanConsent.map((b) => b.hewan)}
              bekal={bekalForm()}
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


      {!inpat && invoice?.paid_status === "DP" && !invoice.correction_pending && <div className="card">
        <h3>DP tercatat — lanjutkan Rawat Inap</h3>
        <p>Hanya untuk pasien yang diputuskan Rawat Inap. Tagihan dan DP lama tidak diubah atau diterima ulang. Dokter PIC dan persetujuan khusus tetap diperiksa.</p>
        <TransactionForm userId={draftUser?.id ?? ""} scope={`inpatient-admit:${visitId}`} action={admitInpatient}>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="request_key" defaultValue={randomUUID()} data-draft-state />
          <label>Tipe rawat inap<select name="stay_type" className="fi" required>{STAY_TYPES.map(type => <option key={type} value={type}>{STAY_TYPE_LABEL[type]}</option>)}</select></label>
          <label>Rencana tindakan dari dokter PIC<input name="treatment_plan" className="fi" required maxLength={4000} /></label>
          <Link href={`/klinik/rekam-medis/${visitId}#persetujuan-rawat-inap`}>Periksa dokter / persetujuan</Link>
          <SubmitButton className="btn-acc" pendingText="Memproses…">Masukkan Rawat Inap (tanpa pembayaran ulang)</SubmitButton>
        </TransactionForm>
      </div>}
      {bolehTagih && pelunasanTerbuka && invoice && (
        <PelunasanTagihanForm key={`${invoice.id}:${sisaPelunasan}`} visitId={visit.id} invoiceId={invoice.id}
          invoiceNo={invoice.invoice_no ?? ""} total={Number(invoice.total)} diterima={paidAmount} sisa={sisaPelunasan} requestKey={randomUUID()} />
      )}
      {!bolehTagih ? null : invoice && canEdit ? (
        <PembayaranForm
          key={`${draftUser?.id ?? ""}:${visit.id}:${invoice?.id ?? "new"}:${invoiceRequestKey}`}
          visitId={visit.id}
          requestKey={invoiceRequestKey}
          draftUserId={draftUser?.id ?? ""}
          sourceVersion={sourceVersion}
          draftScope={`payment:${visit.id}:${invoice?.id ?? "new"}`}
          patient={invoicePatient}
          ppnRate={ppnRate}
          initialObat={initialObat}
          initialJasa={initialJasa}
          manualUnitsEnabled={manualUnitsEnabled}
          masterObat={masterObat}
          masterJasa={masterJasa}
          bekal={bekalForm()}
          catatanResep={mr?.catatan_resep ?? null}
          initialDiscount={Number(invoice.discount)}
          initialDpAmount={Number(invoice.dp_amount)}
          initialCreditAmount={creditAmount}
          initialDpDate={invoice.dp_date}
          initialMetode={invoice.metode_bayar ?? "Tunai"}
          sealedSalespersonName={sealedSalespersonName}
          cashierName={cashier.name}
          serviceStaff={serviceStaff}
          visitDoctorId={visit.doctor_id ?? null}
          minDpPercent={minDpPercent}
          bolehTerobosDp={bolehTerobosDp}
          editMode
          targetInvoiceId={invoice.id}
        />
      ) : invoice ? (
        <>
          {demoSnapshot && <div className="p2ban">DEMO: admin {demoSnapshot.fee_bearer === "customer" ? "pelanggan" : "perusahaan"} {rp(Number(demoSnapshot.fee_amount))} · satu pool insentif {rp(Number(demoSnapshot.incentive_pool))}. Snapshot uang terkunci; terbit ulang mempertahankan nominal dan penerima.</div>}
          <div className="p2ban" style={{ background: lunas ? "#e8f5ee" : "#fffbeb", border: `.5px solid ${lunas ? "#86efac" : "#fcd34d"}`, color: lunas ? "#15803d" : "#92400e" }}>
            <i className={`ti ti-${lunas ? "circle-check" : "clock-dollar"}`} /> Status: {invoice.paid_status}
            {invoice.paid_status === "DP" && !pelunasanTerbuka && ` — diterima ${rp(paidAmount)}, sisa ${rp(Number(invoice.total) - paidAmount)}`}
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
                {canEdit && (
                  <Link href={`/klinik/pembayaran/${visit.id}?edit=1&invoice_id=${invoice.id}`} className="btn-def"
                    style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-pencil" /> Edit Invoice
                  </Link>
                )}
                {lunas && !inpat && (
                  <Link href={`/klinik/pembayaran/${visit.id}/struk`} className="btn-def"
                    style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-receipt-2" /> Struk
                  </Link>
                )}
                <Link href={`/klinik/pembayaran/${visit.id}/invoice?invoice_id=${invoice.id}`} className="btn-acc"
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
                    <td style={{ fontWeight: 500 }}>{l.deskripsi}{l.salesperson_name && <div style={{fontSize:10}}>Penjual (data lama): {l.salesperson_name}</div>}<div style={{fontSize:10}}>{servicePerformerNames(l.service_performers).join(" · ")}</div></td>
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

          {/* J03: refund per baris untuk invoice lunas. */}
          {refundData && (
            <ClinicRefundPanel data={refundData} visitId={visit.id} userId={draftUser?.id}
              invoice={{ id: invoice.id, subtotal: Number(invoice.subtotal), total: Number(invoice.total) }}
              lines={(invItems ?? []).map((l) => ({ id: l.id, deskripsi: l.deskripsi, qty: Number(l.qty), harga: Number(l.harga), jenis: l.jenis, item_id: l.item_id,
                diskon_persen: l.diskon_persen === null ? null : Number(l.diskon_persen), compound_recipe_id: l.compound_recipe_id, satuan: l.satuan }))}
              message={success && !["bayar", "edit", "rombongan", "reissue"].includes(success) ? success : undefined} />
          )}

          {/* Void & Reissue — hanya invoice lunas (Addendum §7). */}
          {bolehTerbitUlang && (lunas || (paymentRows ?? []).length > 0) && !invoice.correction_pending && (
            <div className="card" style={{ marginTop: 12, borderColor: "#fca5a5" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>
                <i className="ti ti-file-x" /> VOID &amp; TERBITKAN ULANG
              </div>
              <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8 }}>
                Pembayaran yang sudah diterima dialihkan ke invoice baru. Setelah koreksi, sisa tagihan dihitung ulang tanpa menerima uang dua kali.
              </div>
              <VoidReissueForm key={invoice.id} visitId={visit.id} invoiceId={invoice.id} requestKey={randomUUID()}/>
            </div>
          )}
        </>
      ) : (
        <PembayaranForm
          key={`${draftUser?.id ?? ""}:${visit.id}:new:${invoiceRequestKey}`}
          visitId={visit.id}
          requestKey={invoiceRequestKey}
          draftUserId={draftUser?.id ?? ""}
          sourceVersion={sourceVersion}
          draftScope={`payment:${visit.id}:new`}
          patient={invoicePatient}
          ppnRate={ppnRate}
          initialObat={initialObat}
          initialJasa={initialJasa}
          manualUnitsEnabled={manualUnitsEnabled}
          masterObat={masterObat}
          masterJasa={masterJasa}
          bekal={bekalForm()}
          packages={clinicPackages}
          demoPolicy={demoPolicy}
          demoStaff={demoStaffResult.data ?? []}
          serviceStaff={serviceStaff}
          visitDoctorId={visit.doctor_id ?? null}
          groomingDoctorRequired={groomingDoctorRequired}
          groomingApplies={groomingPolicy?.applies ?? false}
          cashierName={cashier.name}
          catatanResep={mr?.catatan_resep ?? null}
          allowDpAdmission={!inpat}
          initialDpAdmission={rawatinap === "1"}
          racikanPending={racikanPending}
          minDpPercent={minDpPercent}
          bolehTerobosDp={bolehTerobosDp}
        />
      )}

      {invoice && <ActivityHistoryLink entity="invoices" id={invoice.id} />}
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
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{new Date(l.edited_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
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
