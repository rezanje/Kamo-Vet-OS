/**
 * Rencana migrasi (dry-run offline): validasi per field, gabung ID LOKAL, jejak sumber asli, tanggal,
 * karantina/pengecualian, payload beku, dan rekonsiliasi hitungan 100%.
 *
 * Tidak ada jaringan. Karantina (galat struktur/data) mengalahkan persetujuan; persetujuan `SETUJU` hanya membuat
 * baris LAYAK DITINJAU untuk apply, bukan otorisasi produksi. Nilai tidak pernah dipotong.
 */
import { createHash } from "node:crypto";
import { kunciHpIndonesia, nomorHpValid } from "../kontak";
import { kunciTeksImporRekamMedis } from "../impor-rekam-medis";
import type { BarisBlok, Blok, Sel } from "./baca-master";
import { selKosong } from "./baca-master";
import { KEPUTUSAN_SETUJU, type NamaBlok } from "./kontrak";

/** Batas efektif (skema DB hasil semua migrasi + batas action untuk teks bebas); lebih = karantina. */
export const BATAS_FIELD = {
  owner_name: 100, phone: 30, address: 1000, patient_name: 100, species: 50, breed: 50, gender: 10,
  doctor: 100, record_no: 100, note: 5000, anamnesis: 10000, clinical_findings: 10000, diagnosis: 10000, therapy: 10000,
  source_key: 500, source_file: 255, source_sheet: 255, local_id: 100,
} as const;

export type PayloadBaris = {
  source_key: string;
  record_no: string | null;
  record_date: string;
  owner_name: string;
  phone: string;
  address: string | null;
  patient_name: string;
  species: string | null;
  breed: string | null;
  gender: string | null;
  dob: string | null;
  doctor: string | null;
  note: string | null;
  anamnesis: string | null;
  clinical_findings: string | null;
  diagnosis: string | null;
  therapy: string | null;
};

export type StatusRencana = "siap" | "karantina" | "dikecualikan";

export type BarisRencana = {
  local_record_id: string;
  local_pet_id: string;
  local_owner_id: string;
  status: StatusRencana;
  /** Pemilik, hewan, dan riwayat sama-sama `SETUJU`, ATAU persetujuan tingkat berkas (SHA-256) dari OWNER. */
  disetujui: boolean;
  alasan: string[];
  peringatan: string[];
  bentukJejak: "berstruktur" | "cadangan" | null;
  /** UUID aktual dari master (format valid); dipakai hanya setelah dibuktikan di cek identitas. */
  customer_uuid: string | null;
  pet_uuid: string | null;
  payload: PayloadBaris | null;
  /** SHA-256 payload kanonik (bukan sidik DB `import_legacy_row_hash`). */
  sidikPayload: string | null;
};

export type HitunganRencana = {
  riwayat: number;
  siap: number;
  karantina: number;
  dikecualikan: number;
  /** Lolos struktur (tidak karantina), terlepas dari persetujuan. */
  kandidat: number;
  /** Kandidat yang ketiga tingkatnya SETUJU. */
  disetujui: number;
  perAlasan: Record<string, number>;
  pemilik: number;
  hewan: number;
  mappingTakTerpakai: number;
};

export type Rencana = {
  versi: string;
  sha256Berkas: string;
  opsi: OpsiRencana;
  baris: BarisRencana[];
  hitungan: HitunganRencana;
  peringatan: string[];
  /** SHA-256 atas versi, berkas, opsi, dan (id, status, sidik payload) semua baris. */
  sidikRencana: string;
};

export type OpsiRencana = {
  /** Tanggal hari ini (WIB, YYYY-MM-DD). Tanggal setelahnya = karantina. */
  hariIni: string;
  /** Kebijakan karantina advisori (bukan constraint DB). */
  tanggalMinimum: string;
  /**
   * Persetujuan OWNER tingkat berkas: SHA-256 berkas yang disetujui untuk dimasukkan "hanya baris yang lolos validasi".
   * Wajib sama persis dengan SHA-256 berkas yang dibaca (berkas lain/berubah = ditolak). Menggantikan kolom keputusan per
   * baris, TIDAK melonggarkan karantina/pengecualian lain. Ikut sidik rencana.
   */
  persetujuanBerkas?: string;
};

export const OPSI_BAWAAN_TANGGAL_MINIMUM = "1990-01-01";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TANGGAL_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

type Nilai<T> = { ok: true; nilai: T } | { ok: false; alasan: string };
const ok = <T>(nilai: T): Nilai<T> => ({ ok: true, nilai });
const gagal = <T>(alasan: string): Nilai<T> => ({ ok: false, alasan });

function selAsli(sel: Sel | undefined): Sel {
  return sel ?? { jenis: "kosong" };
}

/** Teks opsional: kosong/spasi = null; rumus/angka/tanggal = karantina; lebih panjang = karantina (tanpa potong). */
function teks(sel: Sel | undefined, field: string, maks: number, opsi: { wajib?: boolean; trim?: boolean } = {}): Nilai<string | null> {
  const s = selAsli(sel);
  if (selKosong(s)) return opsi.wajib ? gagal(`${field}.kosong`) : ok(null);
  if (s.jenis === "rumus") return gagal(`${field}.rumus`);
  if (s.jenis !== "teks") return gagal(`${field}.bukan_teks`);
  const nilai = opsi.trim === false ? s.teks : s.teks.trim();
  if ([...nilai].length > maks) return gagal(`${field}.terlalu_panjang`);
  return ok(nilai);
}

/** ID lokal: teks atau bilangan bulat; tidak pernah di-cast ke UUID. */
function idLokal(sel: Sel | undefined, field: string): Nilai<string> {
  const s = selAsli(sel);
  if (s.jenis === "angka" && Number.isSafeInteger(s.angka)) return ok(String(s.angka));
  const t = teks(s, field, BATAS_FIELD.local_id, { wajib: true });
  return t.ok ? ok(t.nilai as string) : gagal(t.alasan);
}

function uuidOpsional(sel: Sel | undefined, field: string): Nilai<string | null> {
  const t = teks(sel, field, 36);
  if (!t.ok) return t;
  if (t.nilai === null) return ok(null);
  return UUID.test(t.nilai) ? ok(t.nilai.toLowerCase()) : gagal(`${field}.bukan_uuid`);
}

function isoDariDate(tanggal: Date): Nilai<string> {
  if (tanggal.getUTCHours() || tanggal.getUTCMinutes() || tanggal.getUTCSeconds() || tanggal.getUTCMilliseconds()) {
    return gagal("memuat_jam");
  }
  const y = tanggal.getUTCFullYear();
  if (y < 1900 || y > 9999) return gagal("mustahil");
  return ok(`${String(y).padStart(4, "0")}-${String(tanggal.getUTCMonth() + 1).padStart(2, "0")}-${String(tanggal.getUTCDate()).padStart(2, "0")}`);
}

function isoValid(teksTanggal: string): boolean {
  const m = teksTanggal.match(TANGGAL_ISO);
  if (!m) return false;
  const d = new Date(`${teksTanggal}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3]);
}

/** Tanggal Excel ASLI saja (bukan teks/angka/rumus); null bila kosong. */
function tanggalAsli(sel: Sel | undefined, field: string, opsi: OpsiRencana, cekMinimum: boolean): Nilai<string | null> {
  const s = selAsli(sel);
  if (selKosong(s)) return ok(null);
  if (s.jenis === "rumus") return gagal(`${field}.rumus`);
  if (s.jenis !== "tanggal") return gagal(`${field}.bukan_tanggal_asli`);
  const iso = isoDariDate(s.tanggal);
  if (!iso.ok) return gagal(`${field}.${iso.alasan}`);
  if (iso.nilai > opsi.hariIni) return gagal(`${field}.masa_depan`);
  if (cekMinimum && iso.nilai < opsi.tanggalMinimum) return gagal(`${field}.sebelum_batas_minimum`);
  return ok(iso.nilai);
}

/** Tanggal di Mapping: tanggal asli atau teks ISO persis; lainnya = tak terbaca. */
function tanggalMapping(sel: Sel | undefined, field: string): Nilai<string | null> {
  const s = selAsli(sel);
  if (selKosong(s)) return ok(null);
  if (s.jenis === "rumus") return gagal(`${field}.rumus`);
  if (s.jenis === "tanggal") {
    const iso = isoDariDate(s.tanggal);
    return iso.ok ? ok(iso.nilai) : gagal(`${field}.${iso.alasan}`);
  }
  if (s.jenis === "teks" && isoValid(s.teks.trim())) return ok(s.teks.trim());
  return gagal(`${field}.tak_terbaca`);
}

function keputusan(sel: Sel | undefined): boolean {
  const s = selAsli(sel);
  return s.jenis === "teks" && s.teks.trim() === KEPUTUSAN_SETUJU;
}

function bentukJejak(key: string): "berstruktur" | "cadangan" | null {
  const bagian = key.split("::");
  if (bagian.length === 4 && /^[0-9]+$/.test(bagian[1]) && bagian.every((b) => b.length > 0)) return "berstruktur";
  if (bagian.length === 2 && bagian.every((b) => b.length > 0)) return "cadangan";
  return null;
}

/** Jejak kanonik untuk deteksi tabrakan (cermin import_legacy_source_key_canonical). */
export function jejakKanonik(key: string): string {
  const bagian = key.split("::");
  if (bagian.length === 4 && /^[0-9]+$/.test(bagian[1])) return [bagian[0], kunciHpIndonesia(bagian[1]), bagian[2], bagian[3]].join("::");
  return key;
}

const templatePasien = (nama: string) => /template.*rek(?:am)?\s*med|rek(?:am)?\s*med.*template/i.test(nama);

export function kanonikJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(kanonikJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${kanonikJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type Pemilik = { id: string; baris: BarisBlok; alasan: string[]; setuju: boolean; name: string | null; phone: string | null; address: string | null; uuid: string | null };
type Hewan = { id: string; ownerId: string; alasan: string[]; setuju: boolean; name: string | null; species: string | null; breed: string | null; gender: string | null; dob: string | null; uuid: string | null; dobMentah: boolean };

function kumpulkanGanda<T extends { id: string }>(items: T[]): Set<string> {
  const lihat = new Map<string, number>();
  for (const item of items) lihat.set(item.id, (lihat.get(item.id) ?? 0) + 1);
  return new Set([...lihat].filter(([, n]) => n > 1).map(([id]) => id));
}

function bacaPemilik(blok: Blok): Pemilik[] {
  return blok.baris.map((b) => {
    const alasan: string[] = [];
    const id = idLokal(b.sel.local_owner_id, "pemilik.local_owner_id");
    const name = teks(b.sel.name, "pemilik.name", BATAS_FIELD.owner_name, { wajib: true });
    const phone = teks(b.sel.phone, "pemilik.phone", BATAS_FIELD.phone, { wajib: true });
    const address = teks(b.sel.address, "pemilik.address", BATAS_FIELD.address);
    const uuid = uuidOpsional(b.sel.customer_uuid, "pemilik.customers_id");
    for (const n of [id, name, address, uuid]) if (!n.ok) alasan.push(n.alasan);
    if (!phone.ok) alasan.push(selAsli(b.sel.phone).jenis === "angka" ? "pemilik.phone.sel_angka" : phone.alasan);
    else if (!nomorHpValid(phone.nilai as string)) alasan.push("pemilik.phone.tidak_valid");
    return {
      id: id.ok ? id.nilai : `#baris${b.baris}`, baris: b, alasan, setuju: keputusan(b.sel.decision),
      name: name.ok ? name.nilai : null, phone: phone.ok ? phone.nilai : null, address: address.ok ? address.nilai : null, uuid: uuid.ok ? uuid.nilai : null,
    };
  });
}

function bacaHewan(blok: Blok, opsi: OpsiRencana): Hewan[] {
  return blok.baris.map((b) => {
    const alasan: string[] = [];
    const id = idLokal(b.sel.local_pet_id, "hewan.local_pet_id");
    const owner = idLokal(b.sel.local_owner_id, "hewan.local_owner_id");
    const name = teks(b.sel.name, "hewan.name", BATAS_FIELD.patient_name, { wajib: true });
    const species = teks(b.sel.species, "hewan.species", BATAS_FIELD.species);
    const breed = teks(b.sel.breed, "hewan.breed", BATAS_FIELD.breed);
    const gender = teks(b.sel.gender, "hewan.gender", BATAS_FIELD.gender);
    const dob = tanggalAsli(b.sel.dob, "hewan.dob", opsi, false);
    const uuid = uuidOpsional(b.sel.pet_uuid, "hewan.pets_id");
    for (const n of [id, owner, name, species, breed, gender, dob, uuid]) if (!n.ok) alasan.push(n.alasan);
    if (name.ok && name.nilai && templatePasien(name.nilai)) alasan.push("hewan.template");
    return {
      id: id.ok ? id.nilai : `#baris${b.baris}`, ownerId: owner.ok ? owner.nilai : "", alasan, setuju: keputusan(b.sel.decision),
      name: name.ok ? name.nilai : null, species: species.ok ? species.nilai : null, breed: breed.ok ? breed.nilai : null,
      gender: gender.ok ? gender.nilai : null, dob: dob.ok ? dob.nilai : null, uuid: uuid.ok ? uuid.nilai : null,
      dobMentah: !selKosong(selAsli(b.sel.dob_raw)),
    };
  });
}

export function buatRencana(versi: string, sha256Berkas: string, blok: Record<NamaBlok, Blok>, opsi: OpsiRencana, peringatanMaster: string[] = []): Rencana {
  if (!isoValid(opsi.hariIni) || !isoValid(opsi.tanggalMinimum)) throw new Error("Opsi tanggal rencana tidak valid.");
  if (opsi.persetujuanBerkas !== undefined && opsi.persetujuanBerkas !== sha256Berkas) {
    throw new Error("Persetujuan berkas tidak cocok dengan SHA-256 berkas yang dibaca.");
  }
  const setujuBerkas = opsi.persetujuanBerkas !== undefined;
  const peringatan = [...peringatanMaster];
  const pemilik = bacaPemilik(blok.pemilik);
  const hewan = bacaHewan(blok.hewan, opsi);
  const pemilikGanda = kumpulkanGanda(pemilik);
  const hewanGanda = kumpulkanGanda(hewan);
  const pemilikById = new Map(pemilik.filter((p) => !pemilikGanda.has(p.id)).map((p) => [p.id, p]));
  const hewanById = new Map(hewan.filter((h) => !hewanGanda.has(h.id)).map((h) => [h.id, h]));

  // Mapping PER-SHEET per ID lokal riwayat (persis).
  const mapping = new Map<string, BarisBlok[]>();
  for (const b of blok.mapping_sheet.baris) {
    const ref = idLokal(b.sel.local_ref, "mapping.local_ref");
    const kunci = ref.ok ? ref.nilai : `#baris${b.baris}`;
    mapping.set(kunci, [...(mapping.get(kunci) ?? []), b]);
  }
  const riwayatIds = new Set<string>();

  const baris: BarisRencana[] = blok.riwayat.baris.map((b) => {
    const alasan: string[] = [];
    const peringatanBaris: string[] = [];
    const recId = idLokal(b.sel.local_record_id, "riwayat.local_record_id");
    const petRef = idLokal(b.sel.local_pet_id, "riwayat.local_pet_id");
    const local_record_id = recId.ok ? recId.nilai : `#baris${b.baris}`;
    riwayatIds.add(local_record_id);
    for (const n of [recId, petRef]) if (!n.ok) alasan.push(n.alasan);

    const pet = petRef.ok ? hewanById.get(petRef.nilai) : undefined;
    if (petRef.ok && hewanGanda.has(petRef.nilai)) alasan.push("induk.hewan_id_ganda");
    else if (petRef.ok && !pet) alasan.push("induk.hewan_tidak_ada");
    const owner = pet ? pemilikById.get(pet.ownerId) : undefined;
    if (pet && pemilikGanda.has(pet.ownerId)) alasan.push("induk.pemilik_id_ganda");
    else if (pet && !owner) alasan.push("induk.pemilik_tidak_ada");
    if (pet?.alasan.length) alasan.push("induk.hewan_karantina");
    if (owner?.alasan.length) alasan.push("induk.pemilik_karantina");
    if (pet?.uuid && !owner?.uuid) alasan.push("hewan.pets_id_tanpa_customers_id");

    const recordDate = tanggalAsli(b.sel.record_date, "riwayat.record_date", opsi, true);
    const recordNo = teks(b.sel.record_no, "riwayat.record_no", BATAS_FIELD.record_no);
    const doctor = teks(b.sel.doctor, "riwayat.doctor", BATAS_FIELD.doctor);
    // Teks klinis dipertahankan apa adanya (tanpa trim); hanya kosong/spasi = null.
    const note = teks(b.sel.note, "riwayat.note", BATAS_FIELD.note, { trim: false });
    const anamnesis = teks(b.sel.anamnesis, "riwayat.anamnesis", BATAS_FIELD.anamnesis, { trim: false });
    const clinical = teks(b.sel.clinical_findings, "riwayat.clinical_findings", BATAS_FIELD.clinical_findings, { trim: false });
    const diagnosis = teks(b.sel.diagnosis, "riwayat.diagnosis", BATAS_FIELD.diagnosis, { trim: false });
    const therapy = teks(b.sel.therapy, "riwayat.therapy", BATAS_FIELD.therapy, { trim: false });
    const sheetSumber = teks(b.sel.source_sheet, "riwayat.source_sheet", BATAS_FIELD.source_sheet);
    for (const n of [recordDate, recordNo, doctor, note, anamnesis, clinical, diagnosis, therapy, sheetSumber]) if (!n.ok) alasan.push(n.alasan);

    // Jejak sumber asli dari Mapping (tidak pernah disusun ulang).
    const maps = mapping.get(local_record_id) ?? [];
    let sourceKey: string | null = null;
    let sourceFile: string | null = null;
    let sourceSheet: string | null = null;
    let bentuk: BarisRencana["bentukJejak"] = null;
    if (maps.length === 0) alasan.push("mapping.hilang");
    else if (maps.length > 1) alasan.push("mapping.ganda");
    else {
      const m = maps[0].sel;
      const key = teks(m.source_key, "mapping.source_key", BATAS_FIELD.source_key, { wajib: true, trim: false });
      const file = teks(m.file, "mapping.file", BATAS_FIELD.source_file, { wajib: true });
      const sheet = teks(m.sheet, "mapping.sheet", BATAS_FIELD.source_sheet, { wajib: true });
      const tab = tanggalMapping(m.tab_date, "mapping.tanggal_tab");
      const cell = tanggalMapping(m.cell_date, "mapping.tanggal_sel");
      for (const n of [key, file, sheet, tab, cell]) if (!n.ok) alasan.push(n.alasan);
      if (key.ok && key.nilai !== null) {
        if (key.nilai !== key.nilai.trim()) alasan.push("mapping.source_key.spasi_tepi");
        bentuk = bentukJejak(key.nilai);
        if (!bentuk) alasan.push("mapping.source_key.bentuk_tidak_dikenal");
        sourceKey = key.nilai;
        if (bentuk === "berstruktur" && owner?.phone && kunciHpIndonesia(key.nilai.split("::")[1]) !== kunciHpIndonesia(owner.phone)) {
          alasan.push("mapping.source_key.hp_beda_dengan_pemilik");
        }
      }
      if (file.ok) sourceFile = file.nilai;
      if (sheet.ok) sourceSheet = sheet.nilai;
      if (sheet.ok && sheetSumber.ok && sheetSumber.nilai && sheet.nilai && sheetSumber.nilai !== sheet.nilai) alasan.push("riwayat.sheet_sumber_beda_dengan_mapping");
      if (sourceFile && templatePasien(sourceFile)) alasan.push("mapping.file_template");
      // Tanggal: tab ≠ sel butuh resolusi tertinjau eksplisit (belum ada di v0) -> karantina; tab tidak dipilih otomatis.
      if (tab.ok && cell.ok && recordDate.ok) {
        const sumber = [tab.nilai, cell.nilai].filter((t): t is string => !!t);
        if (tab.nilai && cell.nilai && tab.nilai !== cell.nilai) alasan.push("tanggal.tab_beda_sel");
        else if (recordDate.nilai && sumber.length && !sumber.includes(recordDate.nilai)) alasan.push("tanggal.usulan_beda_sumber");
        else if (recordDate.nilai && !sumber.length) peringatanBaris.push("tanggal.tanpa_tanggal_sumber");
      }
    }
    if (pet?.dobMentah && !pet.dob) peringatanBaris.push("hewan.dob_parsial_tidak_dikirim");

    const disetujui = setujuBerkas || (keputusan(b.sel.decision) && !!pet?.setuju && !!owner?.setuju);
    const klinis = [doctor, note, anamnesis, clinical, diagnosis, therapy].every((n) => n.ok && n.nilai === null);

    let status: StatusRencana = "siap";
    if (alasan.length) status = "karantina";
    else {
      if (!disetujui) alasan.push("belum_disetujui");
      if (recordDate.ok && recordDate.nilai === null) alasan.push("tanggal.belum_terselesaikan");
      if (klinis) alasan.push("tanpa_isi_klinis");
      if (alasan.length) status = "dikecualikan";
    }

    let payload: PayloadBaris | null = null;
    if (status === "siap" && owner && pet && sourceKey && recordDate.ok && recordDate.nilai) {
      payload = {
        source_key: sourceKey,
        record_no: recordNo.ok ? recordNo.nilai : null,
        record_date: `${recordDate.nilai}T00:00:00+07:00`,
        owner_name: owner.name!,
        phone: owner.phone!,
        address: owner.address,
        patient_name: pet.name!,
        species: pet.species,
        breed: pet.breed,
        gender: pet.gender,
        dob: pet.dob,
        doctor: doctor.ok ? doctor.nilai : null,
        note: note.ok ? note.nilai : null,
        anamnesis: anamnesis.ok ? anamnesis.nilai : null,
        clinical_findings: clinical.ok ? clinical.nilai : null,
        diagnosis: diagnosis.ok ? diagnosis.nilai : null,
        therapy: therapy.ok ? therapy.nilai : null,
      };
    }
    return {
      local_record_id,
      local_pet_id: petRef.ok ? petRef.nilai : "",
      local_owner_id: pet?.ownerId ?? "",
      status, disetujui, alasan, peringatan: peringatanBaris, bentukJejak: bentuk,
      customer_uuid: owner?.uuid ?? null, pet_uuid: pet?.uuid ?? null,
      payload, sidikPayload: payload ? sha256(kanonikJson(payload)) : null,
      // jejak untuk tahap tabrakan (tidak diekspor)
      ...{ _jejak: sourceKey } as object,
    } as BarisRencana;
  });

  // ID riwayat ganda dan tabrakan jejak (persis/kanonik, termasuk cadangan lintas pemilik): TAHAN SEMUA.
  const idGanda = kumpulkanGanda(baris.map((r) => ({ id: r.local_record_id })));
  const perJejak = new Map<string, BarisRencana[]>();
  for (const r of baris) {
    const jejak = (r as unknown as { _jejak: string | null })._jejak;
    if (!jejak) continue;
    const kanon = jejakKanonik(jejak);
    perJejak.set(kanon, [...(perJejak.get(kanon) ?? []), r]);
  }
  // Isi ganda: hewan + tanggal + isi klinis sama dengan jejak berbeda.
  const perIsi = new Map<string, BarisRencana[]>();
  for (const r of baris) {
    if (!r.payload) continue;
    const { source_key: _abaikan, ...isi } = r.payload;
    void _abaikan;
    const k = `${r.local_pet_id}|${kanonikJson(isi)}`;
    perIsi.set(k, [...(perIsi.get(k) ?? []), r]);
  }
  const tandai = (r: BarisRencana, alasan: string) => {
    if (!r.alasan.includes(alasan)) r.alasan.push(alasan);
    r.status = "karantina";
    r.payload = null;
    r.sidikPayload = null;
  };
  for (const r of baris) if (idGanda.has(r.local_record_id)) tandai(r, "riwayat.id_ganda");
  for (const grup of perJejak.values()) if (grup.length > 1) grup.forEach((r) => tandai(r, "jejak.tabrakan"));
  for (const grup of perIsi.values()) if (grup.length > 1) grup.forEach((r) => tandai(r, "isi.ganda"));
  // Karantina mengalahkan pengecualian: buang alasan pengecualian bila sudah karantina.
  for (const r of baris) {
    delete (r as unknown as { _jejak?: string })._jejak;
    if (r.status === "karantina") r.alasan = r.alasan.filter((a) => !["belum_disetujui", "tanggal.belum_terselesaikan", "tanpa_isi_klinis"].includes(a));
  }

  const perAlasan: Record<string, number> = {};
  for (const r of baris) for (const a of r.alasan) perAlasan[a] = (perAlasan[a] ?? 0) + 1;
  const hitungan: HitunganRencana = {
    riwayat: baris.length,
    siap: baris.filter((r) => r.status === "siap").length,
    karantina: baris.filter((r) => r.status === "karantina").length,
    dikecualikan: baris.filter((r) => r.status === "dikecualikan").length,
    kandidat: baris.filter((r) => r.status !== "karantina").length,
    disetujui: baris.filter((r) => r.status !== "karantina" && r.disetujui).length,
    perAlasan,
    pemilik: pemilik.length,
    hewan: hewan.length,
    mappingTakTerpakai: [...mapping.keys()].filter((k) => !riwayatIds.has(k)).length,
  };
  if (hitungan.siap + hitungan.karantina + hitungan.dikecualikan !== hitungan.riwayat) throw new Error("Rekonsiliasi hitungan rencana gagal.");
  if (hitungan.mappingTakTerpakai) peringatan.push(`${hitungan.mappingTakTerpakai} baris mapping tidak merujuk riwayat mana pun.`);

  const sidikRencana = sha256(kanonikJson({
    versi, sha256Berkas, opsi,
    baris: baris.map((r) => [r.local_record_id, r.status, r.sidikPayload, r.customer_uuid, r.pet_uuid]),
  }));
  return { versi, sha256Berkas, opsi, baris, hitungan, peringatan, sidikRencana };
}

/** Kunci teks identitas (cermin import_legacy_text_key) — pustaka impor yang sudah ada. */
export const kunciTeksIdentitas = kunciTeksImporRekamMedis;

export { isoValid };
