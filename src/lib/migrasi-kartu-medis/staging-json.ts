/**
 * Adapter paket staging JSON (`staging-card-v1`, ekspor Google Sheets kartu medis) ke rencana runner PR355.
 *
 * - Kartu: stable_key = SHA-256(fileID + U+001F + sheet) diverifikasi; kartu ganda/beda isi = galat paket.
 * - Delta tanggal (`date-audit-v2`): diterapkan per stable_key SEBELUM rencana, tidak pernah menambah kartu. Gerbang:
 *   stable_key + source_file_id + sheet + source_sha256 kartu revisi wajib sama dengan kartu asal, dan isi klinis/identitas
 *   tidak boleh berubah (delta hanya status/alasan/tanggal). Gagal gerbang = baris itu ditahan, bukan ditebak.
 * - Status: kandidat -> divalidasi ulang (HP, tanggal, batas kolom DB, isi klinis); held_review -> karantina (dan
 *   "Perlu Dilengkapi" bila kekurangannya bisa dilengkapi petugas); excluded_empty_clinical -> dikecualikan.
 * - Jejak: `gdrive:<fileID>::<sheet>` (unik per berkas Drive; bentuk cadangan dua bagian). Jejak lama
 *   `<nama berkas>::<sheet>` dicek ke DB sebelum eksekusi (lihat cocokkanJejakLama di eksekutor).
 * - Teks klinis dikirim utuh (tanpa trim/potong). Kolom tanpa tempat di DB: catatan "Ket" klinis -> TAHAN (tidak
 *   dibuang diam-diam); warna bulu / DOB parsial / kelamin > batas kolom -> tidak dikirim + catatan per baris.
 * Tidak ada jaringan.
 */
import { createHash } from "node:crypto";
import { kunciHpIndonesia, nomorHpValid } from "../kontak";
import { kunciTeksImporRekamMedis as kunciTeks } from "../impor-rekam-medis";
import {
  BATAS_FIELD, kanonikJson, sha256, type BarisRencana, type HitunganRencana, type KartuTertunda, type KodeKekurangan,
  type PayloadBaris, type Rencana,
} from "./rencana";

export const VERSI_STAGING = "staging-card-v1";
export const VERSI_KONTRAK_STAGING = "staging-card-v1+date-audit-v2";

export type FieldStaging = Partial<Record<
  "patient_name" | "owner_name" | "phone_raw" | "record_no" | "date_raw" | "species" | "fur_color" | "breed" | "gender" | "dob_raw"
  | "address" | "note" | "doctor" | "anamnesis" | "clinical_findings" | "diagnosis" | "therapy" | "additional_notes"
  | "phone_canonical" | "date_card" | "date_tab" | "record_date", string | null>>;

export type KartuStaging = {
  stable_key: string;
  source_file_id: string;
  filename: string;
  sheet: string;
  source_sha256: string;
  status: "candidate_fields_complete_not_import_validated" | "held_review" | "excluded_empty_clinical";
  hold_reasons: string[];
  normalized_fields: FieldStaging;
  batch: string;
};

export type TargetDelta = { batch: string; key: string; status: string; reasons: string; record_date: string | null; date_tab: string | null };

export type HasilPaket = { kartu: KartuStaging[]; galat: string[]; peringatan: string[]; deltaDiterapkan: number; deltaDiluarCakupan: number; deltaDitahan: string[] };

const STATUS = new Set(["candidate_fields_complete_not_import_validated", "held_review", "excluded_empty_clinical"]);
const HEX64 = /^[0-9a-f]{64}$/;
const KLINIS = ["note", "anamnesis", "clinical_findings", "diagnosis", "therapy"] as const;
/** Field yang TIDAK boleh berubah oleh delta tanggal (identitas + isi klinis). */
const TETAP = ["patient_name", "owner_name", "phone_raw", "phone_canonical", "record_no", "species", "fur_color", "breed", "gender",
  "dob_raw", "address", "doctor", "additional_notes", ...KLINIS] as const;

export const stableKey = (fileId: string, sheet: string) => createHash("sha256").update(`${fileId}\u001f${sheet}`, "utf8").digest("hex");

function kartuSah(c: unknown, batch: string, galat: string[]): KartuStaging | null {
  const o = c as Record<string, unknown>;
  const teks = (v: unknown) => typeof v === "string" && v.length > 0;
  if (!o || typeof o !== "object" || !teks(o.stable_key) || !teks(o.source_file_id) || !teks(o.filename) || typeof o.sheet !== "string"
    || !teks(o.source_sha256) || !STATUS.has(o.status as string) || !Array.isArray(o.hold_reasons) || !o.normalized_fields
    || typeof o.normalized_fields !== "object") {
    galat.push(`Batch ${batch}: kartu tidak sesuai skema.`);
    return null;
  }
  const nf = o.normalized_fields as Record<string, unknown>;
  for (const [k, v] of Object.entries(nf)) {
    if (v !== null && typeof v !== "string") { galat.push(`Batch ${batch}: field ${k} bukan teks.`); return null; }
  }
  if (!HEX64.test(o.stable_key as string) || stableKey(o.source_file_id as string, o.sheet as string) !== o.stable_key) {
    galat.push(`Batch ${batch}: stable_key tidak sama dengan SHA256(fileID + U+001F + sheet).`);
    return null;
  }
  return { ...(o as unknown as KartuStaging), normalized_fields: nf as FieldStaging, batch };
}

/** Baca berkas batch (`batchNN-cards.json`) + delta (target + kartu revisi). Paket rusak = galat (gagal tertutup). */
export function bacaPaketStaging(
  batches: unknown[],
  delta?: { targets: unknown; revisi: unknown[] },
): HasilPaket {
  const galat: string[] = [];
  const peringatan: string[] = [];
  const perKunci = new Map<string, KartuStaging>();
  for (const b of batches) {
    const d = b as { schema_version?: unknown; batch?: unknown; cards?: unknown };
    if (!d || d.schema_version !== VERSI_STAGING || typeof d.batch !== "string" || !Array.isArray(d.cards)) {
      galat.push("Berkas batch bukan staging-card-v1.");
      continue;
    }
    const batch = d.batch.slice(0, 2);
    for (const c of d.cards) {
      const k = kartuSah(c, batch, galat);
      if (!k) continue;
      const ada = perKunci.get(k.stable_key);
      if (ada && kanonikJson(ada.normalized_fields) !== kanonikJson(k.normalized_fields)) galat.push(`stable_key ganda dengan isi berbeda (${k.stable_key.slice(0, 12)}…).`);
      if (!ada) perKunci.set(k.stable_key, k);
    }
  }
  let deltaDiterapkan = 0;
  let deltaDiluarCakupan = 0;
  const deltaDitahan: string[] = [];
  if (delta) {
    if (!Array.isArray(delta.targets)) galat.push("Delta: daftar target tidak terbaca.");
    const revisi = new Map<string, KartuStaging>();
    for (const r of delta.revisi) {
      const d = r as { schema_version?: unknown; batch?: unknown; cards?: unknown };
      if (!d || !Array.isArray(d.cards) || typeof d.batch !== "string") { galat.push("Delta: berkas revisi tidak terbaca."); continue; }
      for (const c of d.cards) {
        const k = kartuSah(c, d.batch.slice(0, 2), galat);
        if (k) revisi.set(k.stable_key, k);
      }
    }
    for (const t of (Array.isArray(delta.targets) ? delta.targets : []) as TargetDelta[]) {
      if (!t || typeof t.key !== "string" || !HEX64.test(t.key) || !STATUS.has(t.status)) { galat.push("Delta: target tidak sesuai skema."); continue; }
      const asal = perKunci.get(t.key);
      if (!asal) { deltaDiluarCakupan += 1; continue; }        // batch tidak dilampirkan (mis. 02/08): tidak pernah ditambahkan
      const rev = revisi.get(t.key);
      const gerbang = rev && rev.source_file_id === asal.source_file_id && rev.sheet === asal.sheet && rev.source_sha256 === asal.source_sha256
        && rev.status === t.status && (rev.normalized_fields.record_date ?? null) === t.record_date
        && TETAP.every((f) => (rev.normalized_fields[f] ?? null) === (asal.normalized_fields[f] ?? null));
      if (!gerbang) {
        // Gerbang gagal: baris ditahan (tidak memakai status lama yang mungkin sudah tidak sah).
        perKunci.set(t.key, { ...asal, status: "held_review", hold_reasons: [...new Set([...asal.hold_reasons, "DELTA_GATE_MISMATCH"])] });
        deltaDitahan.push(t.key);
        continue;
      }
      perKunci.set(t.key, {
        ...asal, status: rev.status, hold_reasons: rev.hold_reasons,
        normalized_fields: { ...asal.normalized_fields, record_date: rev.normalized_fields.record_date ?? null,
          date_tab: rev.normalized_fields.date_tab ?? null, date_card: rev.normalized_fields.date_card ?? null },
      });
      deltaDiterapkan += 1;
    }
    if (deltaDiluarCakupan) peringatan.push(`${deltaDiluarCakupan} target delta untuk batch yang tidak dilampirkan diabaikan (tidak ditambahkan).`);
  }
  return { kartu: [...perKunci.values()], galat, peringatan, deltaDiterapkan, deltaDiluarCakupan, deltaDitahan };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoSah = (t: string) => ISO.test(t) && new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t;
const isi = (v: string | null | undefined) => (v != null && v.trim() !== "" ? v : null);

/**
 * Jejak `gdrive:<fileID>::<sheet>`. Spasi di UJUNG dibuang persis seperti DB (`btrim` pada simpan massal), supaya jejak
 * yang dikirim = jejak yang tersimpan = jejak yang dibalas. Dua kartu yang jadi berjejak sama = TAHAN (jejak.tabrakan).
 */
export const jejakStaging = (k: Pick<KartuStaging, "source_file_id" | "sheet">) => `gdrive:${k.source_file_id}::${k.sheet}`.replace(/^ +| +$/g, "");

/** Kode kekurangan "Perlu Dilengkapi" dari alasan tahan staging; null = tidak bisa dilengkapi petugas. */
const PETA_TAHAN: Record<string, KodeKekurangan | null> = {
  PHONE_PREFIX_MISSING_OR_INVALID_NO_GUESS: "hp_tidak_valid",
  DATE_TAB_CARD_CONFLICT: "tanggal_bentrok",
  COPY_TAB_DATE_CARD_CONFLICT: "tanggal_bentrok",
  DATE_TAB_AMBIGUOUS_OR_UNPARSED: "tanggal_kosong",
  CARD_DATE_MISSING_OR_INVALID: "tanggal_kosong",
  PATIENT_NAME_MISSING: "nama_hewan_kosong",
  CLINICAL_CELL_DATE_TYPED_REVIEW: null,
  CLINICAL_PLACEHOLDER_ONLY: null,
  DELTA_GATE_MISMATCH: null,
};

export type OpsiRencanaStaging = { hariIni: string; tanggalMinimum: string; sha256Paket: string };

/**
 * Rencana runner dari kartu staging. Persetujuan = izin OWNER untuk paket ini (terikat sha256Paket).
 * local_owner_id = kunci HP kanonik; local_pet_id = kunci HP + kunci nama hewan.
 */
export function rencanaDariStaging(kartu: KartuStaging[], opsi: OpsiRencanaStaging): Rencana {
  if (!isoSah(opsi.hariIni) || !isoSah(opsi.tanggalMinimum) || !HEX64.test(opsi.sha256Paket)) throw new Error("Opsi rencana staging tidak valid.");
  const urut = [...kartu].sort((a, b) => a.stable_key.localeCompare(b.stable_key));
  const baris: BarisRencana[] = urut.map((k) => {
    const f = k.normalized_fields;
    const alasan: string[] = [];
    const peringatan: string[] = [];
    const hp = isi(f.phone_canonical) ?? isi(f.phone_raw);
    const kunciHp = hp ? kunciHpIndonesia(hp) : "";
    const pasien = isi(f.patient_name);
    const pemilik = isi(f.owner_name);
    const sourceKey = jejakStaging(k);
    if (sourceKey.length > BATAS_FIELD.source_key) alasan.push("mapping.source_key.terlalu_panjang");
    const klinisAda = KLINIS.some((c) => isi(f[c]) !== null);

    if (k.status === "excluded_empty_clinical") alasan.push("tanpa_isi_klinis");
    else if (k.status === "held_review") for (const h of k.hold_reasons.length ? k.hold_reasons : ["HELD_REVIEW"]) alasan.push(`staging.${h}`);
    else {
      if (!pemilik) alasan.push("pemilik.name.kosong");
      if (!hp) alasan.push("pemilik.phone.kosong");
      else if (!nomorHpValid(hp) || kunciHp.length < 10) alasan.push("pemilik.phone.tidak_valid");
      if (!pasien) alasan.push("hewan.name.kosong");
      const rd = isi(f.record_date);
      if (!rd || !isoSah(rd)) alasan.push("tanggal.belum_terselesaikan");
      else if (rd > opsi.hariIni) alasan.push("riwayat.record_date.masa_depan");
      else if (rd < opsi.tanggalMinimum) alasan.push("riwayat.record_date.sebelum_batas_minimum");
      if (!klinisAda) alasan.push("tanpa_isi_klinis");
      // Batas kolom DB: lebih panjang = tahan (tidak pernah dipotong).
      const batas: [keyof FieldStaging, number][] = [["owner_name", BATAS_FIELD.owner_name], ["patient_name", BATAS_FIELD.patient_name],
        ["species", BATAS_FIELD.species], ["breed", BATAS_FIELD.breed], ["doctor", BATAS_FIELD.doctor], ["record_no", BATAS_FIELD.record_no],
        ["address", BATAS_FIELD.address], ["note", BATAS_FIELD.note], ["anamnesis", BATAS_FIELD.anamnesis],
        ["clinical_findings", BATAS_FIELD.clinical_findings], ["diagnosis", BATAS_FIELD.diagnosis], ["therapy", BATAS_FIELD.therapy]];
      for (const [c, n] of batas) if ([...(f[c] ?? "")].length > n) alasan.push(`riwayat.${c}.terlalu_panjang`);
      if ((hp ?? "").length > BATAS_FIELD.phone) alasan.push("pemilik.phone.terlalu_panjang");
      // "Ket" klinis tidak punya kolom tujuan: ditahan, bukan dibuang.
      if (isi(f.additional_notes)) alasan.push("riwayat.ket_tanpa_kolom");
    }
    if (isi(f.fur_color)) peringatan.push("hewan.warna_bulu_tidak_dikirim");
    if (isi(f.dob_raw)) peringatan.push("hewan.dob_parsial_tidak_dikirim");
    const gender = isi(f.gender);
    if (gender && [...gender].length > BATAS_FIELD.gender) peringatan.push("hewan.kelamin_terlalu_panjang_tidak_dikirim");

    const status: BarisRencana["status"] = alasan.length === 0 ? "siap"
      : alasan.every((a) => a === "tanpa_isi_klinis") ? "dikecualikan" : "karantina";

    let payload: PayloadBaris | null = null;
    if (status === "siap") {
      const phone = isi(f.phone_raw) && nomorHpValid(f.phone_raw!.trim()) && kunciHpIndonesia(f.phone_raw!) === kunciHp ? f.phone_raw!.trim() : hp!;
      payload = {
        source_key: sourceKey, record_no: isi(f.record_no)?.trim() ?? null, record_date: `${f.record_date}T00:00:00+07:00`,
        owner_name: pemilik!.trim(), phone, address: isi(f.address)?.trim() ?? null, patient_name: pasien!.trim(),
        species: isi(f.species)?.trim() ?? null, breed: isi(f.breed)?.trim() ?? null,
        gender: gender && [...gender.trim()].length <= BATAS_FIELD.gender ? gender.trim() : null, dob: null,
        doctor: isi(f.doctor)?.trim() ?? null,
        // Teks klinis utuh (tanpa trim/potong).
        note: isi(f.note), anamnesis: isi(f.anamnesis), clinical_findings: isi(f.clinical_findings), diagnosis: isi(f.diagnosis), therapy: isi(f.therapy),
      };
    }

    // "Perlu Dilengkapi": hanya bila SEMUA alasan bisa dilengkapi petugas dan ada isi klinis.
    let tertunda: KartuTertunda | null = null;
    if (status !== "siap" && klinisAda && k.status === "held_review") {
      const kode = k.hold_reasons.map((h) => PETA_TAHAN[h]);
      if (kode.length && kode.every((x) => x)) {
        const kekurangan = [...new Set((kode as KodeKekurangan[]).map((x) => (x === "hp_tidak_valid" && !hp ? "hp_kosong" : x)))];
        const isiKartu: Record<string, string> = {};
        const tambah = (kunci: string, v: string | null | undefined, maks: number) => { if (isi(v) && [...v!].length <= maks) isiKartu[kunci] = v!; };
        tambah("owner_name", pemilik?.trim(), BATAS_FIELD.owner_name); tambah("phone", (isi(f.phone_raw) ?? "").trim(), BATAS_FIELD.phone);
        tambah("address", isi(f.address)?.trim(), BATAS_FIELD.address); tambah("patient_name", pasien?.trim(), BATAS_FIELD.patient_name);
        tambah("species", isi(f.species)?.trim(), BATAS_FIELD.species); tambah("breed", isi(f.breed)?.trim(), BATAS_FIELD.breed);
        if (gender && [...gender.trim()].length <= BATAS_FIELD.gender) isiKartu.gender = gender.trim();
        tambah("record_no", isi(f.record_no)?.trim(), BATAS_FIELD.record_no); tambah("doctor", isi(f.doctor)?.trim(), BATAS_FIELD.doctor);
        for (const t of ["record_date", "date_tab", "date_card"] as const) {
          const v = isi(f[t]);
          if (v && isoSah(v)) isiKartu[t === "record_date" ? "tanggal_usulan" : t === "date_tab" ? "tanggal_tab" : "tanggal_sel"] = v;
        }
        let muat = true;
        for (const c of KLINIS) {
          const v = isi(f[c]);
          if (v && [...v].length > (BATAS_FIELD as Record<string, number>)[c]) muat = false;
          if (v) isiKartu[c] = v;
        }
        if (isi(f.additional_notes)) muat = false;                      // Ket klinis tidak punya kolom: tetap di laporan saja
        if (muat) {
          tertunda = { source_key: sourceKey, local_record_id: k.stable_key, sumber_berkas: k.filename.slice(0, 255), sumber_sheet: k.sheet.slice(0, 255),
            kekurangan: kekurangan.sort(), isi: isiKartu };
        }
      }
    }
    return {
      local_record_id: k.stable_key, local_pet_id: `${kunciHp}|${kunciTeks(pasien ?? "")}`, local_owner_id: kunciHp,
      status, disetujui: true, alasan, peringatan, bentukJejak: "cadangan", customer_uuid: null, pet_uuid: null,
      payload, sidikPayload: payload ? sha256(kanonikJson(payload)) : null, tertunda,
    };
  });
  // Jejak sama (setelah buang spasi ujung) di antara baris siap: TAHAN SEMUA.
  const perJejak = new Map<string, BarisRencana[]>();
  for (const r of baris) if (r.payload) perJejak.set(r.payload.source_key, [...(perJejak.get(r.payload.source_key) ?? []), r]);
  for (const grup of perJejak.values()) if (grup.length > 1) for (const r of grup) {
    r.status = "karantina"; r.alasan.push("jejak.tabrakan"); r.payload = null; r.sidikPayload = null;
  }
  // Isi ganda (hewan + isi sama, jejak beda) di antara baris siap: TAHAN SEMUA (tidak memilih salah satu).
  const perIsi = new Map<string, BarisRencana[]>();
  for (const r of baris) {
    if (!r.payload) continue;
    const { source_key: _s, ...isiPayload } = r.payload; void _s;
    const k = `${r.local_pet_id}|${kanonikJson(isiPayload)}`;
    perIsi.set(k, [...(perIsi.get(k) ?? []), r]);
  }
  for (const grup of perIsi.values()) if (grup.length > 1) for (const r of grup) {
    r.status = "karantina"; r.alasan.push("isi.ganda"); r.payload = null; r.sidikPayload = null;
  }
  const perAlasan: Record<string, number> = {};
  for (const r of baris) for (const a of r.alasan) perAlasan[a] = (perAlasan[a] ?? 0) + 1;
  const hitungan: HitunganRencana = {
    riwayat: baris.length,
    siap: baris.filter((r) => r.status === "siap").length,
    karantina: baris.filter((r) => r.status === "karantina").length,
    dikecualikan: baris.filter((r) => r.status === "dikecualikan").length,
    kandidat: baris.filter((r) => r.status !== "karantina").length,
    disetujui: baris.length,
    perAlasan,
    pemilik: new Set(baris.map((r) => r.local_owner_id).filter(Boolean)).size,
    hewan: new Set(baris.map((r) => r.local_pet_id)).size,
    mappingTakTerpakai: 0,
    tertunda: baris.filter((r) => r.tertunda).length,
  };
  const opsiRencana = { hariIni: opsi.hariIni, tanggalMinimum: opsi.tanggalMinimum };
  const sidikRencana = sha256(kanonikJson({
    versi: VERSI_KONTRAK_STAGING, sha256Berkas: opsi.sha256Paket, opsi: opsiRencana,
    baris: baris.map((r) => [r.local_record_id, r.status, r.sidikPayload, r.customer_uuid, r.pet_uuid]),
  }));
  return { versi: VERSI_KONTRAK_STAGING, sha256Berkas: opsi.sha256Paket, opsi: opsiRencana, baris, hitungan, peringatan: [], sidikRencana };
}

/** SHA-256 paket = hash atas (nama, sha256) setiap berkas masukan, urut nama. */
export function sha256Paket(berkas: { nama: string; bytes: Uint8Array }[]): string {
  const daftar = berkas.map((b) => [b.nama, createHash("sha256").update(b.bytes).digest("hex")]).sort((a, b) => a[0].localeCompare(b[0]));
  return sha256(kanonikJson(daftar));
}

/** Kunci jejak lama yang mungkin sudah ada di DB untuk kartu ini (impor UI lama tanpa jalur folder). */
export function jejakLamaKandidat(k: Pick<KartuStaging, "filename" | "sheet">): string[] {
  return [...new Set([`${k.filename}::${k.sheet}`, `${k.filename.trim()}::${k.sheet}`, `${k.filename}::${k.sheet.trim()}`])];
}
