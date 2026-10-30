/**
 * Resolusi identitas BACA-SAJA (tidak pernah memanggil simpan massal).
 *
 * Aturan identitas (keputusan OWNER, batch kartu medis 2026-10-30):
 * - Nomor HP = patokan utama; 08… dan +628… sama setelah normalisasi. Nomor sama + nama berbeda = SATU pemilik (nama
 *   lama di database dipertahankan, varian dicatat). >1 kartu database dengan nomor yang sama = TAHAN (tidak pernah
 *   menggabungkan dua akun). Nomor kosong/tidak valid sudah dikarantina di rencana (tidak pernah dikarang).
 * - Hewan tetap terpisah per nama di bawah pemilik: SEMUA anabul cocok dihitung, termasuk nonaktif (F2): >1 TAHAN,
 *   1 = UUID eksplisit, 0 = dibuat DB. Dua hewan lokal yang menjadi satu hewan baru bernama sama wajib demografinya tidak
 *   bertentangan; bila bertentangan = TAHAN.
 * - F4: `import_legacy_identity_scan` INVOKER/RLS, jejak persis saja -> `sudah_ada` BUKAN bukti. Jawaban rusak = gagal.
 * - Demografi yang SUDAH ADA tidak diubah RPC. Nama/alamat pemilik yang berbeda = catatan (dipertahankan). Data hewan yang
 *   bertentangan (keduanya terisi, beda) = TAHAN; kosong di database = catatan "tidak diisi otomatis".
 * Residual: selama fallback pembuatan anabul di DB masih ada, snapshot tidak menjamin bebas balapan; dicek ulang tepat
 * sebelum tiap batch.
 */
import { kunciHpIndonesia } from "../kontak";
import { kunciTeksImporRekamMedis as kunciTeks } from "../impor-rekam-medis";
import { GagalTertutup, UUID_RE, type KlienMigrasi } from "./klien";
import type { BarisRencana, PayloadBaris } from "./rencana";

export const MAKS_BARIS_PER_SCAN = 300;
const MAKS_ID_PER_PILIH = 100;

type Pemilik = { id: string; name: string; phone: string | null };
type Hewan = { id: string; customer_id: string; name: string };
export type DemografiPemilik = { id: string; name: string; phone: string | null; address: string | null };
export type DemografiHewan = { id: string; customer_id: string; name: string; species: string | null; breed: string | null; gender: string | null; dob: string | null };

export type SnapshotIdentitas = {
  customer_id: string | null;
  pet_id: string | null;
  kandidatPemilik: string[];
  kandidatHewan: string[];
  demografi: string;
};

export type Resolusi =
  | { status: "kirim"; customer_id: string | null; pet_id: string | null; snapshot: SnapshotIdentitas; catatan: string[] }
  | { status: "tahan"; alasan: string[] };

const lowerTrim = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const sama = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();

function teksAtauNull(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new GagalTertutup(`Jawaban identitas rusak (${field}).`);
  return v;
}

function validasiScan(data: unknown): { pemilik: Pemilik[]; hewan: Hewan[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new GagalTertutup("Jawaban pemeriksaan identitas rusak.");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.sudah_ada) || !Array.isArray(d.customers) || !Array.isArray(d.pets)) throw new GagalTertutup("Jawaban pemeriksaan identitas tidak lengkap.");
  if (d.sudah_ada.some((k) => typeof k !== "string")) throw new GagalTertutup("Jawaban pemeriksaan identitas rusak (sudah_ada).");
  const pemilik = d.customers.map((c) => {
    const o = c as Record<string, unknown>;
    if (typeof o?.id !== "string" || !UUID_RE.test(o.id) || typeof o.name !== "string") throw new GagalTertutup("Jawaban pemeriksaan identitas rusak (customers).");
    return { id: o.id, name: o.name, phone: teksAtauNull(o.phone, "phone") };
  });
  const hewan = d.pets.map((p) => {
    const o = p as Record<string, unknown>;
    if (typeof o?.id !== "string" || !UUID_RE.test(o.id) || typeof o.customer_id !== "string" || !UUID_RE.test(o.customer_id) || typeof o.name !== "string") {
      throw new GagalTertutup("Jawaban pemeriksaan identitas rusak (pets).");
    }
    return { id: o.id, customer_id: o.customer_id, name: o.name };
  });
  const idPemilik = new Set(pemilik.map((p) => p.id));
  if (hewan.some((h) => !idPemilik.has(h.customer_id))) throw new GagalTertutup("Jawaban pemeriksaan identitas tidak konsisten (anabul tanpa calon pemilik).");
  return { pemilik, hewan };
}

async function scan(klien: KlienMigrasi, payloads: PayloadBaris[]) {
  const pemilik = new Map<string, Pemilik>();
  const hewan = new Map<string, Hewan>();
  for (let i = 0; i < payloads.length; i += MAKS_BARIS_PER_SCAN) {
    const potong = payloads.slice(i, i + MAKS_BARIS_PER_SCAN);
    const { data, error } = await klien.rpc("import_legacy_identity_scan", {
      p_source_keys: [...new Set(potong.map((p) => p.source_key))],
      p_owner_keys: [...new Set(potong.map((p) => kunciTeks(p.owner_name)))],
      p_phone_keys: [...new Set(potong.map((p) => kunciHpIndonesia(p.phone)))],
    });
    if (error) throw new GagalTertutup("Pemeriksaan identitas ditolak/gagal.");
    const hasil = validasiScan(data);
    hasil.pemilik.forEach((p) => pemilik.set(p.id, p));
    hasil.hewan.forEach((h) => hewan.set(h.id, h));
  }
  return { pemilik: [...pemilik.values()], hewan: [...hewan.values()] };
}

async function pilihLengkap<T>(klien: KlienMigrasi, tabel: "customers" | "pets", kolom: string, ids: string[], ubah: (row: Record<string, unknown>) => T & { id: string }) {
  const hasil = new Map<string, T & { id: string }>();
  const unik = [...new Set(ids)];
  for (let i = 0; i < unik.length; i += MAKS_ID_PER_PILIH) {
    const potong = unik.slice(i, i + MAKS_ID_PER_PILIH);
    const { data, error } = await klien.pilih(tabel, kolom, potong);
    if (error || !Array.isArray(data)) throw new GagalTertutup(`Demografi ${tabel} tidak terbaca.`);
    for (const row of data) {
      const r = ubah(row as Record<string, unknown>);
      if (hasil.has(r.id) || !potong.includes(r.id)) throw new GagalTertutup(`Demografi ${tabel} tidak konsisten.`);
      hasil.set(r.id, r);
    }
  }
  if (hasil.size !== unik.length) throw new GagalTertutup(`Demografi ${tabel} tidak lengkap.`);
  return hasil;
}

function demografiPemilik(row: Record<string, unknown>): DemografiPemilik {
  if (typeof row.id !== "string" || typeof row.name !== "string") throw new GagalTertutup("Demografi customers rusak.");
  return { id: row.id, name: row.name, phone: teksAtauNull(row.phone, "phone"), address: teksAtauNull(row.address, "address") };
}
function demografiHewan(row: Record<string, unknown>): DemografiHewan {
  if (typeof row.id !== "string" || typeof row.customer_id !== "string" || typeof row.name !== "string") throw new GagalTertutup("Demografi pets rusak.");
  return {
    id: row.id, customer_id: row.customer_id, name: row.name, species: teksAtauNull(row.species, "species"),
    breed: teksAtauNull(row.breed, "breed"), gender: teksAtauNull(row.gender, "gender"), dob: teksAtauNull(row.dob, "dob"),
  };
}

const normal = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export type BandingDemografi = { tahan: string[]; catatan: string[] };

/**
 * Bandingkan nilai master dengan data yang sudah ada (RPC tidak memperbaruinya). Nomor HP / nama hewan beda = TAHAN;
 * nama/alamat pemilik beda = catatan (data lama dipertahankan); data hewan bertentangan = TAHAN, kosong di DB = catatan.
 */
export function bandingDemografi(p: PayloadBaris, pemilik: DemografiPemilik | null, hewan: DemografiHewan | null): BandingDemografi {
  const tahan: string[] = [];
  const catatan: string[] = [];
  if (pemilik) {
    if (kunciHpIndonesia(pemilik.phone) !== kunciHpIndonesia(p.phone)) tahan.push("demografi.pemilik.phone");
    if (kunciTeks(pemilik.name) !== kunciTeks(p.owner_name)) catatan.push("demografi.pemilik.name_dipertahankan");
    if (p.address !== null && !sama(pemilik.address, p.address)) catatan.push("demografi.pemilik.address_dipertahankan");
  }
  if (hewan) {
    if (kunciTeks(hewan.name) !== kunciTeks(p.patient_name) && lowerTrim(hewan.name) !== lowerTrim(p.patient_name)) tahan.push("demografi.hewan.name");
    const bidang: [string, string | null, string | null][] = [
      ["species", hewan.species, p.species], ["breed", hewan.breed, p.breed], ["gender", hewan.gender, p.gender],
      ["dob", hewan.dob ? hewan.dob.slice(0, 10) : null, p.dob],
    ];
    for (const [nama, lama, baru] of bidang) {
      if (baru === null || normal(lama) === normal(baru)) continue;
      if (normal(lama) === "") catatan.push(`demografi.hewan.${nama}_tidak_diisi`);
      else tahan.push(`demografi.hewan.${nama}`);
    }
  }
  return { tahan, catatan };
}

/** Kompatibel lama: kode TAHAN saja. */
export function selisihDemografi(p: PayloadBaris, pemilik: DemografiPemilik | null, hewan: DemografiHewan | null): string[] {
  return bandingDemografi(p, pemilik, hewan).tahan;
}

/** Kunci HP kanonik payload (dipakai untuk mengelompokkan pemilik baru). */
export const kunciHpPayload = (p: PayloadBaris) => kunciHpIndonesia(p.phone);

/** Resolusi identitas untuk baris `siap` (payload + UUID eksplisit master). Satu Map per local_record_id. */
export async function resolusiIdentitas(klien: KlienMigrasi, baris: BarisRencana[]): Promise<Map<string, Resolusi>> {
  const siap = baris.filter((b) => b.status === "siap" && b.payload);
  const hasil = new Map<string, Resolusi>();
  if (!siap.length) return hasil;
  const { pemilik, hewan } = await scan(klien, siap.map((b) => b.payload!));

  const awal = siap.map((b) => {
    const p = b.payload!;
    const alasan: string[] = [];
    const catatan: string[] = [];
    const hp = kunciHpIndonesia(p.phone);
    const viaHp = hp ? pemilik.filter((c) => kunciHpIndonesia(c.phone) === hp) : [];
    let customer: string | null = null;
    if (b.customer_uuid) {
      if (!viaHp.some((c) => c.id === b.customer_uuid)) alasan.push("identitas.customers_id_bukan_kandidat");
      customer = b.customer_uuid;
    } else if (viaHp.length > 1) alasan.push("identitas.pemilik_ganda_hp");
    else if (viaHp.length === 1) customer = viaHp[0].id;
    else {
      catatan.push("identitas.pemilik_baru");
      if (pemilik.some((c) => kunciTeks(c.name) === kunciTeks(p.owner_name))) catatan.push("identitas.nama_sama_nomor_beda");
    }

    const milik = customer ? hewan.filter((h) => h.customer_id === customer) : [];
    const cocok = milik.filter((h) => kunciTeks(h.name) === kunciTeks(p.patient_name) || lowerTrim(h.name) === lowerTrim(p.patient_name));
    let pet: string | null = null;
    if (b.pet_uuid) {
      if (!customer || !milik.some((h) => h.id === b.pet_uuid)) alasan.push("identitas.pets_id_bukan_milik_pemilik");
      else if (cocok.length && !cocok.some((h) => h.id === b.pet_uuid)) alasan.push("identitas.pets_id_bukan_yang_cocok");
      pet = b.pet_uuid;
    } else if (cocok.length > 1) alasan.push("identitas.hewan_ganda");
    else if (cocok.length === 1) pet = cocok[0].id;
    return {
      b, alasan, catatan, customer, pet, hp,
      kandidatPemilik: viaHp.map((c) => c.id).sort(),
      kandidatHewan: cocok.map((h) => h.id).sort(),
    };
  });

  // Hewan BARU yang sama (pemilik/HP sama + nama sama) dari beberapa baris/hewan lokal: demografi tidak boleh bertentangan.
  const grupBaru = new Map<string, typeof awal>();
  for (const a of awal) {
    if (a.alasan.length || a.pet) continue;
    const k = `${a.customer ?? `hp:${a.hp}`}|${kunciTeks(a.b.payload!.patient_name)}`;
    grupBaru.set(k, [...(grupBaru.get(k) ?? []), a]);
  }
  for (const grup of grupBaru.values()) {
    const bentrok = (["species", "breed", "gender", "dob"] as const).some((f) => new Set(grup.map((a) => normal(a.b.payload![f])).filter(Boolean)).size > 1);
    if (bentrok) { grup.forEach((a) => a.alasan.push("identitas.hewan_baru_demografi_bentrok")); continue; }
    const pembuat = grup[0].b.payload!;
    grup.forEach((a, i) => {
      a.catatan.push("identitas.hewan_baru");
      if (i === 0) return;
      for (const f of ["species", "breed", "gender", "dob"] as const) {
        if (a.b.payload![f] !== null && pembuat[f] === null) a.catatan.push(`demografi.hewan.${f}_tidak_diisi`);
      }
    });
  }

  const ok = awal.filter((a) => !a.alasan.length);
  const demoPemilik = await pilihLengkap(klien, "customers", "id,name,phone,address", ok.flatMap((a) => (a.customer ? [a.customer] : [])), demografiPemilik);
  const demoHewan = await pilihLengkap(klien, "pets", "id,customer_id,name,species,breed,gender,dob", ok.flatMap((a) => (a.pet ? [a.pet] : [])), demografiHewan);

  for (const a of awal) {
    if (a.alasan.length) { hasil.set(a.b.local_record_id, { status: "tahan", alasan: a.alasan }); continue; }
    const dp = a.customer ? demoPemilik.get(a.customer)! : null;
    const dh = a.pet ? demoHewan.get(a.pet)! : null;
    if (dh && dh.customer_id !== a.customer) { hasil.set(a.b.local_record_id, { status: "tahan", alasan: ["identitas.hewan_bukan_milik_pemilik"] }); continue; }
    const banding = bandingDemografi(a.b.payload!, dp, dh);
    if (banding.tahan.length) { hasil.set(a.b.local_record_id, { status: "tahan", alasan: banding.tahan }); continue; }
    hasil.set(a.b.local_record_id, {
      status: "kirim", customer_id: a.customer, pet_id: a.pet, catatan: [...a.catatan, ...banding.catatan],
      snapshot: {
        customer_id: a.customer, pet_id: a.pet, kandidatPemilik: a.kandidatPemilik, kandidatHewan: a.kandidatHewan,
        demografi: JSON.stringify([dp, dh]),
      },
    });
  }
  return hasil;
}

/** Snapshot sama persis? Dipakai untuk cek ulang tepat sebelum batch dikirim. */
export function snapshotSama(a: SnapshotIdentitas, b: SnapshotIdentitas) {
  return a.customer_id === b.customer_id && a.pet_id === b.pet_id && a.demografi === b.demografi
    && a.kandidatPemilik.join(",") === b.kandidatPemilik.join(",") && a.kandidatHewan.join(",") === b.kandidatHewan.join(",");
}
