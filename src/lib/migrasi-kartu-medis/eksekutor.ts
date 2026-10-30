/**
 * Eksekutor migrasi (mode jaringan, hanya bila dipanggil eksplisit dengan klien OWNER terautentikasi yang di-inject).
 *
 * - Satu pekerja, batch berurutan ≤150 (ukuran UI yang ada, bukan kapasitas produksi terukur).
 * - Penanda `dikirim` ditulis tahan-crash SEBELUM jaringan; jawaban divalidasi penuh (tipe, jumlah, urutan jejak, status,
 *   UUID) SEBELUM diakui. Jawaban rusak/parsial/putus = `tidak_pasti` dan run berhenti.
 * - Lanjutkan mengirim ulang payload, urutan, dan jejak YANG SAMA (sidik rencana sama). DB mengembalikan `sudah_ada`
 *   untuk baris yang ternyata sudah ter-commit (jejak + sidik baris sama).
 * - Hanya RPC simpan massal yang menulis; tidak ada INSERT tabel langsung.
 */
import { BukuBesar, type BarisLedger, type BatchLedger, type HasilLedger, type StateLedger } from "./buku-besar";
import { GagalTertutup, UUID_RE, pastikanPemanggil, type KlienMigrasi } from "./klien";
import { resolusiIdentitas, selisihDemografi, snapshotSama, type Resolusi } from "./identitas";
import { kanonikJson, sha256, type BarisRencana, type PayloadBaris, type Rencana } from "./rencana";

export const UKURAN_BATCH_MAKS = 150;

export type PayloadKirim = PayloadBaris & { customer_id: string | null; pet_id: string | null };

/** Kode alasan dari teks alasan DB (teks tidak disimpan di ledger). */
export function kodeAlasan(reason: string | null): string | null {
  if (reason === null) return null;
  if (reason.startsWith("Jejak sumber bentrok")) return "db.jejak_bentrok";
  if (reason.startsWith("Jejak sumber belum terbukti sama")) return "db.jejak_belum_terbukti";
  if (reason.startsWith("Jejak sumber ganda")) return "db.jejak_ganda";
  if (reason.startsWith("Jejak sumber ini sudah tercatat pada riwayat yang tidak bisa diakses")) return "db.jejak_tak_terjangkau";
  if (reason.startsWith("Perlu keputusan identitas")) return "db.perlu_keputusan_identitas";
  if (/tidak cocok dengan (nama|pemilik)/.test(reason)) return "db.identitas_tidak_cocok";
  if (/value too long/.test(reason)) return "db.terlalu_panjang";
  return "db.lain";
}

export class JawabanTidakValid extends Error {}

/** Validasi penuh jawaban simpan massal terhadap kiriman (urutan dipertahankan oleh RPC). */
export function validasiJawabanBulk(data: unknown, kiriman: PayloadKirim[]) {
  if (!Array.isArray(data)) throw new JawabanTidakValid("bukan larik");
  if (data.length !== kiriman.length) throw new JawabanTidakValid("jumlah tidak sama");
  const visit = new Set<string>();
  return data.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new JawabanTidakValid("baris bukan objek");
    const o = item as Record<string, unknown>;
    if (o.source_key !== kiriman[i].source_key) throw new JawabanTidakValid("urutan/jejak tidak sesuai");
    if (o.status !== "tersimpan" && o.status !== "sudah_ada" && o.status !== "ditahan") throw new JawabanTidakValid("status tidak dikenal");
    if (o.reason !== null && o.reason !== undefined && typeof o.reason !== "string") throw new JawabanTidakValid("alasan rusak");
    const v = o.visit_id ?? null;
    if (o.status === "ditahan") {
      if (v !== null) throw new JawabanTidakValid("baris ditahan memuat visit_id");
    } else {
      if (typeof v !== "string" || !UUID_RE.test(v)) throw new JawabanTidakValid("visit_id tidak valid");
      if (visit.has(v)) throw new JawabanTidakValid("visit_id ganda");
      visit.add(v);
    }
    return { status: o.status, reason: (o.reason as string | null | undefined) ?? null, visit_id: v as string | null };
  });
}

/** Hitungan KUMULATIF untuk seluruh ledger (semua run/lanjutan dengan rencana yang sama), bukan hanya pemanggilan ini. */
export type HasilJalan = {
  status: "selesai" | "berhenti_tidak_pasti";
  batchDiakui: number;
  tersimpan: number;
  sudahAda: number;
  ditahanDb: Record<string, number>;
  ditahanIdentitas: Record<string, number>;
  belumDikirim: number;
  /** Mengapa run berhenti tidak pasti (kode, tanpa PHI). */
  sebab?: string;
};

function ringkas(state: StateLedger, siap: number, status: HasilJalan["status"]): HasilJalan {
  const hasil = state.batches.flatMap((b) => b.hasil ?? []);
  const ditahanDb: Record<string, number> = {};
  for (const h of hasil) if (h.status === "ditahan") ditahanDb[h.alasan ?? "db.lain"] = (ditahanDb[h.alasan ?? "db.lain"] ?? 0) + 1;
  const ditahanIdentitas: Record<string, number> = {};
  for (const d of state.ditahanIdentitas) for (const a of d.alasan) ditahanIdentitas[a] = (ditahanIdentitas[a] ?? 0) + 1;
  const tercakup = new Set([...state.batches.flatMap((b) => b.baris.map((r) => r.local_record_id)), ...state.ditahanIdentitas.map((d) => d.local_record_id)]);
  return {
    status,
    batchDiakui: state.batches.filter((b) => b.status === "diakui").length,
    tersimpan: hasil.filter((h) => h.status === "tersimpan").length,
    sudahAda: hasil.filter((h) => h.status === "sudah_ada").length,
    ditahanDb,
    ditahanIdentitas,
    belumDikirim: siap - tercakup.size,
  };
}

function payloadKirim(r: BarisRencana, customer_id: string | null, pet_id: string | null): PayloadKirim {
  return { ...r.payload!, customer_id, pet_id };
}

const STATUS_BATCH = new Set(["dikirim", "diakui", "tidak_pasti"]);
const STATUS_HASIL = new Set(["tersimpan", "sudah_ada", "ditahan"]);
const nullAtauUuid = (v: unknown) => v === null || (typeof v === "string" && UUID_RE.test(v));

/**
 * Ledger wajib terikat ke rencana + konteks ini dan utuh, SEBELUM ada bacaan DB. `lengkap` (readback): semua batch diakui dan
 * SETIAP baris siap punya tepat satu disposisi (hasil batch atau tahan identitas) — tanpa ID ganda/hilang/asing.
 */
export function validasiLedger(rencana: Rencana, buku: BukuBesar, konteks: KlienMigrasi["konteks"], lengkap: boolean): StateLedger {
  const m = buku.meta;
  if (m.sidikRencana !== rencana.sidikRencana || m.sha256Berkas !== rencana.sha256Berkas || m.versiKontrak !== rencana.versi) {
    throw new GagalTertutup("Ledger bukan untuk rencana ini.");
  }
  if (JSON.stringify(m.konteks) !== JSON.stringify(konteks)) throw new GagalTertutup("Konteks klien berbeda dengan ledger.");
  const state = buku.baca();
  const rusak = () => new GagalTertutup("Ledger rusak atau tidak konsisten.");
  if (!state || !Array.isArray(state.batches) || !Array.isArray(state.ditahanIdentitas)) throw rusak();
  const siap = new Map(rencana.baris.filter((r) => r.status === "siap" && r.payload).map((r) => [r.local_record_id, r]));
  const lihat = new Set<string>();
  const visit = new Set<string>();
  const catat = (id: unknown) => {
    if (typeof id !== "string" || !siap.has(id) || lihat.has(id)) throw rusak();
    lihat.add(id);
  };
  state.batches.forEach((b, i) => {
    if (!b || b.no !== i + 1 || !STATUS_BATCH.has(b.status) || !Array.isArray(b.baris) || !b.baris.length) throw rusak();
    for (const lr of b.baris) {
      catat(lr.local_record_id);
      if (!nullAtauUuid(lr.customer_id) || !nullAtauUuid(lr.pet_id) || (lr.pet_id && !lr.customer_id)) throw rusak();
      const p = payloadKirim(siap.get(lr.local_record_id)!, lr.customer_id, lr.pet_id);
      if (sha256(kanonikJson(p)) !== lr.sidikPayload || sha256(p.source_key) !== lr.kunciHash) throw new GagalTertutup("Payload ledger tidak cocok dengan rencana.");
    }
    if (b.status === "diakui") {
      if (!Array.isArray(b.hasil) || b.hasil.length !== b.baris.length) throw rusak();
      b.hasil.forEach((h, j) => {
        if (!h || h.local_record_id !== b.baris[j].local_record_id || !STATUS_HASIL.has(h.status)) throw rusak();
        if (h.status === "ditahan" ? h.visit_id !== null : !(typeof h.visit_id === "string" && UUID_RE.test(h.visit_id))) throw rusak();
        if (h.visit_id) { if (visit.has(h.visit_id)) throw rusak(); visit.add(h.visit_id); }
      });
    } else if (b.hasil !== undefined) throw rusak();
  });
  for (const d of state.ditahanIdentitas) {
    catat(d?.local_record_id);
    if (!Array.isArray(d.alasan) || !d.alasan.length || d.alasan.some((a) => typeof a !== "string")) throw rusak();
  }
  if (lengkap) {
    if (state.batches.some((b) => b.status !== "diakui")) throw new GagalTertutup("Masih ada batch tidak pasti; lanjutkan dulu.");
    const hilang = [...siap.keys()].filter((id) => !lihat.has(id)).length;
    if (hilang) throw new GagalTertutup(`Ledger tidak lengkap: ${hilang} baris siap belum punya disposisi.`);
  }
  return state;
}

/**
 * Sebelum mengirim ulang batch yang belum pasti (R1): buktikan BACA-SAJA bahwa pengiriman ulang payload identik tidak
 * bisa membuat identitas lewat fallback DB yang berubah sejak percobaan pertama.
 * - Jejak yang sudah ada (pembaca RS-1, jejak setara kanonik; cermin cari_jejak untuk baris rencana) -> DB tidak membuat
 *   apa pun untuk baris itu (sudah_ada / ditahan).
 * - Jejak yang belum ada -> resolusi identitas segar wajib `kirim` dengan customer_id/pet_id SAMA dengan yang tersimpan.
 * Selain itu (jawaban rusak/tidak lengkap, identitas berubah) -> tidak aman; batch tetap tidak pasti, nol mutasi.
 */
async function amanDiulang(klien: KlienMigrasi, batch: BatchLedger, perId: Map<string, BarisRencana>, kiriman: PayloadKirim[]): Promise<string | null> {
  const kunci = kiriman.map((k) => k.source_key);
  let ada: Set<string>;
  try {
    const { data, error } = await klien.rpc("hasil_impor_rekam_medis", { p_keys: kunci });
    if (error || !Array.isArray(data) || data.length >= 500) return "status_commit_tidak_terbukti";
    ada = new Set();
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row?.kunci !== "string" || !kunci.includes(row.kunci) || typeof row.visit_id !== "string" || !UUID_RE.test(row.visit_id)) return "status_commit_tidak_terbukti";
      ada.add(row.kunci);
    }
  } catch {
    return "status_commit_tidak_terbukti";
  }
  const belum = batch.baris.filter((_, i) => !ada.has(kunci[i]));
  if (!belum.length) return null;
  let res: Map<string, Resolusi>;
  try {
    res = await resolusiIdentitas(klien, belum.map((b) => perId.get(b.local_record_id)!));
  } catch {
    return "identitas_tidak_terbukti";
  }
  for (const b of belum) {
    const r = res.get(b.local_record_id);
    if (r?.status !== "kirim" || r.customer_id !== b.customer_id || r.pet_id !== b.pet_id) return "identitas_berubah_sebelum_ulang";
  }
  return null;
}

async function kirimBatch(klien: KlienMigrasi, buku: BukuBesar, state: StateLedger, batch: BatchLedger, kiriman: PayloadKirim[]) {
  batch.status = "dikirim";
  buku.simpan(state);                                  // penanda tahan-crash SEBELUM jaringan
  let hasil: ReturnType<typeof validasiJawabanBulk>;
  try {
    const { data, error } = await klien.rpc("import_legacy_medical_records_bulk", { p_rows: kiriman });
    if (error) throw new JawabanTidakValid("panggilan ditolak/gagal");
    hasil = validasiJawabanBulk(data, kiriman);
  } catch (e) {
    batch.status = "tidak_pasti";
    batch.sebab = e instanceof JawabanTidakValid ? e.message : "jaringan/putus";
    buku.simpan(state);
    return false;
  }
  batch.hasil = hasil.map((h, i): HasilLedger => ({
    local_record_id: batch.baris[i].local_record_id, status: h.status as HasilLedger["status"],
    alasan: kodeAlasan(h.reason), visit_id: h.visit_id,
  }));
  batch.status = "diakui";
  delete batch.sebab;
  buku.simpan(state);
  return true;
}

/**
 * Jalankan atau lanjutkan. `rencana` dan `buku` harus untuk berkas/rencana/konteks yang sama (BukuBesar menolak bila beda).
 */
export async function jalankanMigrasi(klien: KlienMigrasi, rencana: Rencana, buku: BukuBesar, opsi: { ukuranBatch: number }): Promise<HasilJalan> {
  if (!Number.isInteger(opsi.ukuranBatch) || opsi.ukuranBatch < 1 || opsi.ukuranBatch > UKURAN_BATCH_MAKS) {
    throw new GagalTertutup(`Ukuran batch 1–${UKURAN_BATCH_MAKS}.`);
  }
  const state = validasiLedger(rencana, buku, klien.konteks, false);
  await pastikanPemanggil(klien);

  const siap = rencana.baris.filter((r) => r.status === "siap" && r.payload);
  const perId = new Map(siap.map((r) => [r.local_record_id, r]));

  // 1) Batch yang belum pasti: payload IDENTIK (urutan, jejak, UUID yang sama), hanya setelah terbukti aman diulang.
  for (const batch of state.batches) {
    if (batch.status === "diakui") continue;
    const kiriman = batch.baris.map((b) => payloadKirim(perId.get(b.local_record_id)!, b.customer_id, b.pet_id));
    const sebab = await amanDiulang(klien, batch, perId, kiriman);
    if (sebab) {
      batch.status = "tidak_pasti";
      batch.sebab = sebab;
      buku.simpan(state);
      return { ...ringkas(state, siap.length, "berhenti_tidak_pasti"), sebab };
    }
    if (!(await kirimBatch(klien, buku, state, batch, kiriman))) return { ...ringkas(state, siap.length, "berhenti_tidak_pasti"), sebab: batch.sebab };
  }

  // 2) Baris yang belum tercakup, per batch: resolusi identitas (baca-saja) lalu cek ulang TEPAT sebelum kirim.
  //    Resolusi per batch (bukan sekali untuk seluruh run) supaya pemilik/anabul yang dibuat batch sebelumnya dikenali
  //    sebagai identitas persis, bukan dianggap "kandidat berubah".
  const tercakup = new Set([...state.batches.flatMap((b) => b.baris.map((r) => r.local_record_id)), ...state.ditahanIdentitas.map((d) => d.local_record_id)]);
  const sisa = siap.filter((r) => !tercakup.has(r.local_record_id));

  let no = state.batches.length;
  for (let i = 0; i < sisa.length; i += opsi.ukuranBatch) {
    const potongRencana = sisa.slice(i, i + opsi.ukuranBatch);
    const resolusi = await resolusiIdentitas(klien, potongRencana);
    const potong: { r: BarisRencana; res: Extract<Resolusi, { status: "kirim" }> }[] = [];
    for (const r of potongRencana) {
      const res = resolusi.get(r.local_record_id);
      if (!res) throw new GagalTertutup("Resolusi identitas tidak lengkap.");
      if (res.status === "tahan") state.ditahanIdentitas.push({ local_record_id: r.local_record_id, alasan: res.alasan });
      else potong.push({ r, res });
    }
    const ulang = potong.length ? await resolusiIdentitas(klien, potong.map((p) => p.r)) : new Map<string, Resolusi>();
    const tetap = potong.filter(({ r, res }) => {
      const baru = ulang.get(r.local_record_id);
      if (baru?.status === "kirim" && snapshotSama(baru.snapshot, res.snapshot)) return true;
      state.ditahanIdentitas.push({ local_record_id: r.local_record_id, alasan: ["identitas.kandidat_berubah"] });
      return false;
    });
    if (!tetap.length) { buku.simpan(state); continue; }
    const kiriman = tetap.map(({ r, res }) => payloadKirim(r, res.customer_id, res.pet_id));
    const baris: BarisLedger[] = tetap.map(({ r }, j) => ({
      local_record_id: r.local_record_id, kunciHash: sha256(kiriman[j].source_key),
      customer_id: kiriman[j].customer_id, pet_id: kiriman[j].pet_id, sidikPayload: sha256(kanonikJson(kiriman[j])),
    }));
    const batch: BatchLedger = { no: ++no, status: "dikirim", baris };
    state.batches.push(batch);
    if (!(await kirimBatch(klien, buku, state, batch, kiriman))) return { ...ringkas(state, siap.length, "berhenti_tidak_pasti"), sebab: batch.sebab };
  }
  return ringkas(state, siap.length, "selesai");
}

// ---------------------------------------------------------------------------------------------------------------
// Readback (OWNER, RS-2): visit -> pet -> customer per visit_id persis, paginasi per hewan dihabiskan, demografi.
// ---------------------------------------------------------------------------------------------------------------

export const HALAMAN_READBACK = 200;
export const MAKS_READBACK_PER_HEWAN = 1000;

/**
 * `terverifikasi` hanya bila ada ≥1 riwayat termigrasi dan semuanya cocok. `kosong` (nol baris siap, atau semua ditahan)
 * BUKAN migrasi yang berhasil. Ledger yang tidak lengkap/asing/rusak ditolak sebelum bacaan DB.
 */
export type HasilReadback = {
  ok: boolean;
  status: "terverifikasi" | "kosong" | "selisih";
  diperiksa: number;
  disposisi: { siap: number; denganKunjungan: number; ditahanDb: number; ditahanIdentitas: number };
  selisih: { local_record_id: string | null; kode: string }[];
};

export async function readbackMigrasi(klien: KlienMigrasi, rencana: Rencana, buku: BukuBesar): Promise<HasilReadback> {
  const state = validasiLedger(rencana, buku, klien.konteks, true);
  await pastikanPemanggil(klien);
  const perId = new Map(rencana.baris.map((r) => [r.local_record_id, r]));
  const selisih: HasilReadback["selisih"] = [];
  const target: { lr: BarisLedger; h: HasilLedger; r: BarisRencana }[] = [];
  for (const b of state.batches) b.hasil!.forEach((h, i) => {
    if (h.visit_id) target.push({ lr: b.baris[i], h, r: perId.get(h.local_record_id)! });
  });

  const petPerLokal = new Map<string, string>();
  const customerPerLokal = new Map<string, string>();
  const visitPerPet = new Map<string, Set<string>>();
  const ditemukan: { r: BarisRencana; pet: string; customer: string; baru: { pet: boolean; customer: boolean } }[] = [];
  for (const { lr, h, r } of target) {
    const { data, error } = await klien.rpc("detail_riwayat_bersama", { p_visit: h.visit_id });
    if (error || !Array.isArray(data)) throw new GagalTertutup("Readback detail gagal dibaca.");
    if (data.length !== 1) { selisih.push({ local_record_id: r.local_record_id, kode: "readback.kunjungan_tidak_ditemukan" }); continue; }
    const d = data[0] as Record<string, unknown>;
    const p = r.payload!;
    if (d.visit_id !== h.visit_id || typeof d.pet_id !== "string" || typeof d.customer_id !== "string") { selisih.push({ local_record_id: r.local_record_id, kode: "readback.bentuk" }); continue; }
    if (lr.pet_id && d.pet_id !== lr.pet_id) selisih.push({ local_record_id: r.local_record_id, kode: "readback.pet_id" });
    if (lr.customer_id && d.customer_id !== lr.customer_id) selisih.push({ local_record_id: r.local_record_id, kode: "readback.customer_id" });
    const cek = (kode: string, a: unknown, b: unknown) => { if ((a ?? null) !== (b ?? null)) selisih.push({ local_record_id: r.local_record_id, kode }); };
    if (typeof d.tanggal !== "string" || Date.parse(d.tanggal) !== Date.parse(p.record_date)) selisih.push({ local_record_id: r.local_record_id, kode: "readback.tanggal" });
    cek("readback.dokter", d.dokter, p.doctor);
    cek("readback.keluhan", d.keluhan, p.note ?? p.anamnesis);
    cek("readback.anamnesis", d.anamnesis, p.anamnesis);
    cek("readback.gejala_klinis", d.gejala_klinis, p.clinical_findings);
    cek("readback.diagnosis", d.diagnosis, p.diagnosis);
    cek("readback.terapi", d.terapi, p.therapy);
    for (const [peta, lokal, nilai, kode] of [[petPerLokal, r.local_pet_id, d.pet_id, "readback.hewan_lokal_terpecah"], [customerPerLokal, r.local_owner_id, d.customer_id, "readback.pemilik_lokal_terpecah"]] as const) {
      const lama = peta.get(lokal);
      if (lama && lama !== nilai) selisih.push({ local_record_id: r.local_record_id, kode });
      peta.set(lokal, nilai as string);
    }
    visitPerPet.set(d.pet_id as string, (visitPerPet.get(d.pet_id as string) ?? new Set()).add(h.visit_id!));
    ditemukan.push({ r, pet: d.pet_id as string, customer: d.customer_id as string, baru: { pet: !lr.pet_id, customer: !lr.customer_id } });
  }

  // Per hewan: habiskan paginasi; >1000 = tidak lengkap (gagal). Setiap visit_id yang diharapkan muncul tepat sekali.
  for (const [pet, harap] of visitPerPet) {
    const muncul = new Map<string, number>();
    let lengkap = false;
    for (let dari = 0; dari < MAKS_READBACK_PER_HEWAN; dari += HALAMAN_READBACK) {
      const { data, error } = await klien.rpc("riwayat_bersama_hewan", { p_pet: pet, p_dari: dari, p_jumlah: HALAMAN_READBACK });
      if (error || !Array.isArray(data) || data.length > HALAMAN_READBACK) throw new GagalTertutup("Readback riwayat hewan gagal dibaca.");
      for (const row of data as Record<string, unknown>[]) {
        if (typeof row.visit_id !== "string" || row.pet_id !== pet) throw new GagalTertutup("Readback riwayat hewan tidak konsisten.");
        muncul.set(row.visit_id, (muncul.get(row.visit_id) ?? 0) + 1);
      }
      if (data.length < HALAMAN_READBACK) { lengkap = true; break; }
    }
    if (!lengkap) {
      const { data, error } = await klien.rpc("riwayat_bersama_hewan", { p_pet: pet, p_dari: MAKS_READBACK_PER_HEWAN, p_jumlah: 1 });
      if (error || !Array.isArray(data)) throw new GagalTertutup("Readback riwayat hewan gagal dibaca.");
      if (data.length) { selisih.push({ local_record_id: null, kode: "readback.hewan_tidak_lengkap" }); continue; }
    }
    for (const v of harap) if (muncul.get(v) !== 1) selisih.push({ local_record_id: null, kode: "readback.daftar_hewan_tidak_cocok" });
  }

  // Demografi pemilik/anabul (SELECT biasa): baru = sama dengan master; yang sudah ada = nilai master terisi sama.
  const ids = (k: "pet" | "customer") => [...new Set(ditemukan.map((d) => d[k]))];
  const baca = async (tabel: "customers" | "pets", kolom: string, daftar: string[]) => {
    const peta = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < daftar.length; i += 100) {
      const { data, error } = await klien.pilih(tabel, kolom, daftar.slice(i, i + 100));
      if (error || !Array.isArray(data)) throw new GagalTertutup(`Readback ${tabel} gagal dibaca.`);
      for (const row of data as Record<string, unknown>[]) peta.set(String(row.id), row);
    }
    return peta;
  };
  const customers = await baca("customers", "id,name,phone,address", ids("customer"));
  const pets = await baca("pets", "id,customer_id,name,species,breed,gender,dob", ids("pet"));
  for (const d of ditemukan) {
    const c = customers.get(d.customer);
    const pt = pets.get(d.pet);
    if (!c || !pt) { selisih.push({ local_record_id: d.r.local_record_id, kode: "readback.demografi_tidak_terbaca" }); continue; }
    if (pt.customer_id !== d.customer) selisih.push({ local_record_id: d.r.local_record_id, kode: "readback.hewan_bukan_milik_pemilik" });
    const p = d.r.payload!;
    if (d.baru.customer && (c.name !== p.owner_name || c.phone !== p.phone || (c.address ?? null) !== p.address)) {
      selisih.push({ local_record_id: d.r.local_record_id, kode: "readback.pemilik_baru_beda" });
    }
    if (d.baru.pet && (pt.name !== p.patient_name || (pt.species ?? null) !== p.species || (pt.breed ?? null) !== p.breed
      || (pt.gender ?? null) !== p.gender || (pt.dob ?? null) !== p.dob)) {
      selisih.push({ local_record_id: d.r.local_record_id, kode: "readback.hewan_baru_beda" });
    }
    const lama = selisihDemografi(p, d.baru.customer ? null : { id: d.customer, name: String(c.name), phone: (c.phone as string) ?? null, address: (c.address as string) ?? null },
      d.baru.pet ? null : { id: d.pet, customer_id: String(pt.customer_id), name: String(pt.name), species: (pt.species as string) ?? null, breed: (pt.breed as string) ?? null, gender: (pt.gender as string) ?? null, dob: (pt.dob as string) ?? null });
    for (const kode of lama) selisih.push({ local_record_id: d.r.local_record_id, kode: `readback.${kode}` });
  }
  const disposisi = {
    siap: rencana.baris.filter((r) => r.status === "siap" && r.payload).length,
    denganKunjungan: target.length,
    ditahanDb: state.batches.flatMap((b) => b.hasil!).filter((h) => h.status === "ditahan").length,
    ditahanIdentitas: state.ditahanIdentitas.length,
  };
  const status = selisih.length ? "selisih" : target.length ? "terverifikasi" : "kosong";
  return { ok: status === "terverifikasi", status, diperiksa: target.length, disposisi, selisih };
}
