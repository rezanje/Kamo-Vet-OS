/**
 * Rekonsiliasi BACA-SAJA paket staging terhadap database sebelum eksekusi (OWNER, RLS):
 *
 * 1. Jejak lama `<nama berkas>::<sheet>` (impor UI lama): bila ada dan isinya (tanggal, dokter, keluhan, anamnesis,
 *    gejala, diagnosis, terapi) SAMA -> kartu ini sudah ada (tidak ditulis ulang dengan jejak baru). Bila isinya beda ->
 *    itu kartu lain bernama berkas sama (tabrakan nama), jejak `gdrive:` dipakai dan dicatat.
 * 2. Kunjungan lain pada hewan yang sama di TANGGAL yang sama (riwayat bersama atau kunjungan cabang) -> TAHAN
 *    (kemungkinan duplikat dengan pencatatan aplikasi), kecuali kunjungan itu memang jejak kartu ini.
 * Tidak ada mutasi. Hasilnya diterapkan ke rencana lalu rencana dibekukan (sidik dihitung ulang).
 */
import { GagalTertutup, UUID_RE, pastikanPemanggil, type KlienMigrasi } from "./klien";
import { resolusiIdentitas, type Resolusi } from "./identitas";
import { kanonikJson, sha256, type BarisRencana, type Rencana } from "./rencana";

export type HasilRekonsiliasi = {
  sudahAdaJejakLama: { local_record_id: string; visit_id: string; kunci: string }[];
  tabrakanNamaBerkas: { local_record_id: string; kunci: string }[];
  tanggalSama: { local_record_id: string; visit_id: string }[];
};

const tanggalWib = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const sama = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

async function hasilImpor(klien: KlienMigrasi, kunci: string[]) {
  const peta = new Map<string, Record<string, unknown>[]>();
  const unik = [...new Set(kunci)];
  for (let i = 0; i < unik.length; i += 400) {
    const potong = unik.slice(i, i + 400);
    const { data, error } = await klien.rpc("hasil_impor_rekam_medis", { p_keys: potong });
    if (error || !Array.isArray(data) || data.length >= 500) throw new GagalTertutup("Pemeriksaan jejak lama gagal.");
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row?.kunci !== "string" || !potong.includes(row.kunci) || typeof row.visit_id !== "string" || !UUID_RE.test(row.visit_id)) {
        throw new GagalTertutup("Jawaban jejak lama rusak.");
      }
      peta.set(row.kunci, [...(peta.get(row.kunci) ?? []), row]);
    }
  }
  return peta;
}

/** `jejakLama(local_record_id)` -> kunci jejak lama kandidat untuk kartu itu. */
export async function rekonsiliasiDb(klien: KlienMigrasi, rencana: Rencana, jejakLama: (id: string) => string[]): Promise<HasilRekonsiliasi> {
  await pastikanPemanggil(klien);
  if (!klien.kunjunganHewan) throw new GagalTertutup("Klien tidak mendukung pembacaan kunjungan hewan.");
  const siap = rencana.baris.filter((r) => r.status === "siap" && r.payload);
  const hasil: HasilRekonsiliasi = { sudahAdaJejakLama: [], tabrakanNamaBerkas: [], tanggalSama: [] };

  // 1) Jejak lama nama berkas (+ jejak kartu ini sendiri, untuk mengenali kunjungannya di langkah 2).
  const lama = await hasilImpor(klien, siap.flatMap((r) => [...jejakLama(r.local_record_id), r.payload!.source_key]));
  const tersisa: BarisRencana[] = [];
  for (const r of siap) {
    const p = r.payload!;
    const temuan = jejakLama(r.local_record_id).filter((k) => k !== p.source_key).flatMap((k) => (lama.get(k) ?? []).map((row) => ({ k, row })));
    const cocok = temuan.find(({ row }) => typeof row.tanggal === "string" && tanggalWib(row.tanggal) === p.record_date.slice(0, 10)
      && sama(row.dokter, p.doctor) && sama(row.keluhan, p.note ?? p.anamnesis) && sama(row.anamnesis, p.anamnesis)
      && sama(row.gejala_klinis, p.clinical_findings) && sama(row.diagnosis, p.diagnosis) && sama(row.terapi, p.therapy));
    if (cocok) { hasil.sudahAdaJejakLama.push({ local_record_id: r.local_record_id, visit_id: cocok.row.visit_id as string, kunci: cocok.k }); continue; }
    if (temuan.length) hasil.tabrakanNamaBerkas.push({ local_record_id: r.local_record_id, kunci: temuan[0].k });
    tersisa.push(r);
  }

  // 2) Kunjungan lain pada tanggal yang sama untuk hewan yang sudah ada.
  const resolusi = new Map<string, Resolusi>();
  for (let i = 0; i < tersisa.length; i += 150) {
    for (const [id, res] of await resolusiIdentitas(klien, tersisa.slice(i, i + 150))) resolusi.set(id, res);
  }
  const petIds = [...new Set([...resolusi.values()].flatMap((res) => (res.status === "kirim" && res.pet_id ? [res.pet_id] : [])))];
  const perHewan = new Map<string, { id: string; tanggal: string; kunci: string | null }[]>();
  for (let i = 0; i < petIds.length; i += 100) {
    const potong = petIds.slice(i, i + 100);
    const { data, error } = await klien.kunjunganHewan(potong);
    if (error || !Array.isArray(data)) throw new GagalTertutup("Kunjungan hewan tidak terbaca.");
    for (const v of data as Record<string, unknown>[]) {
      if (typeof v?.id !== "string" || typeof v.pet_id !== "string" || !potong.includes(v.pet_id) || typeof v.created_at !== "string") {
        throw new GagalTertutup("Kunjungan hewan rusak.");
      }
      perHewan.set(v.pet_id, [...(perHewan.get(v.pet_id) ?? []), { id: v.id, tanggal: tanggalWib(v.created_at), kunci: (v.legacy_source_key as string | null) ?? null }]);
    }
  }
  // Riwayat bersama (tanpa cabang) dibaca lewat RPC RS-2 agar tidak bergantung konteks cabang SELECT biasa.
  for (const pet of petIds) {
    for (let dari = 0; dari < 1000; dari += 200) {
      const { data, error } = await klien.rpc("riwayat_bersama_hewan", { p_pet: pet, p_dari: dari, p_jumlah: 200 });
      if (error || !Array.isArray(data) || data.length > 200) throw new GagalTertutup("Riwayat bersama hewan tidak terbaca.");
      for (const v of data as Record<string, unknown>[]) {
        if (typeof v?.visit_id !== "string" || v.pet_id !== pet || typeof v.tanggal !== "string") throw new GagalTertutup("Riwayat bersama hewan rusak.");
        const daftar = perHewan.get(pet) ?? [];
        if (!daftar.some((x) => x.id === v.visit_id)) daftar.push({ id: v.visit_id, tanggal: tanggalWib(v.tanggal), kunci: null });
        perHewan.set(pet, daftar);
      }
      if (data.length < 200) break;
      if (dari + 200 >= 1000) throw new GagalTertutup("Riwayat hewan terlalu banyak untuk diperiksa lengkap.");
    }
  }
  // Kunjungan milik paket ini sendiri (mis. sudah ter-commit pada percobaan sebelumnya) bukan duplikat aplikasi.
  const kunciRencana = new Set(siap.map((r) => r.payload!.source_key));
  const kunjunganRencana = new Set(siap.flatMap((r) => (lama.get(r.payload!.source_key) ?? []).map((row) => row.visit_id as string)));
  for (const r of tersisa) {
    const res = resolusi.get(r.local_record_id);
    if (res?.status !== "kirim" || !res.pet_id) continue;
    const bentrok = (perHewan.get(res.pet_id) ?? []).find((v) => v.tanggal === r.payload!.record_date.slice(0, 10)
      && !(v.kunci !== null && kunciRencana.has(v.kunci)) && !kunjunganRencana.has(v.id));
    if (bentrok) hasil.tanggalSama.push({ local_record_id: r.local_record_id, visit_id: bentrok.id });
  }
  return hasil;
}

/** Terapkan hasil rekonsiliasi ke rencana (salinan) dan hitung ulang hitungan + sidik. */
export function terapkanRekonsiliasi(rencana: Rencana, h: HasilRekonsiliasi): Rencana {
  const r2: Rencana = JSON.parse(JSON.stringify(rencana));
  const per = new Map(r2.baris.map((b) => [b.local_record_id, b]));
  const tandai = (id: string, status: BarisRencana["status"], alasan: string) => {
    const b = per.get(id);
    if (!b || b.status !== "siap") throw new GagalTertutup("Rekonsiliasi merujuk baris yang tidak siap.");
    b.status = status; b.alasan = [alasan]; b.payload = null; b.sidikPayload = null;
  };
  for (const x of h.sudahAdaJejakLama) tandai(x.local_record_id, "dikecualikan", "db.sudah_ada_jejak_lama");
  for (const x of h.tanggalSama) tandai(x.local_record_id, "karantina", "db.kunjungan_tanggal_sama");
  for (const x of h.tabrakanNamaBerkas) per.get(x.local_record_id)?.peringatan.push("db.nama_berkas_sama_kartu_lain");
  return hitungUlang(r2);
}

export function hitungUlang(r: Rencana): Rencana {
  const perAlasan: Record<string, number> = {};
  for (const b of r.baris) for (const a of b.alasan) perAlasan[a] = (perAlasan[a] ?? 0) + 1;
  r.hitungan = {
    ...r.hitungan, perAlasan,
    siap: r.baris.filter((b) => b.status === "siap").length,
    karantina: r.baris.filter((b) => b.status === "karantina").length,
    dikecualikan: r.baris.filter((b) => b.status === "dikecualikan").length,
    kandidat: r.baris.filter((b) => b.status !== "karantina").length,
    tertunda: r.baris.filter((b) => b.tertunda).length,
  };
  r.sidikRencana = sidik(r);
  return r;
}

export const sidik = (r: Rencana) => sha256(kanonikJson({
  versi: r.versi, sha256Berkas: r.sha256Berkas, opsi: r.opsi,
  baris: r.baris.map((b) => [b.local_record_id, b.status, b.sidikPayload, b.customer_uuid, b.pet_uuid]),
}));

/** Muat rencana beku: setiap sidik payload dan sidik rencana dihitung ulang; beda = ditolak. */
export function muatRencanaBeku(json: unknown): Rencana {
  const r = json as Rencana;
  if (!r || !Array.isArray(r.baris) || typeof r.sidikRencana !== "string") throw new GagalTertutup("Rencana beku rusak.");
  for (const b of r.baris) {
    if ((b.payload ? sha256(kanonikJson(b.payload)) : null) !== b.sidikPayload) throw new GagalTertutup("Payload rencana beku berubah.");
  }
  if (sidik(r) !== r.sidikRencana) throw new GagalTertutup("Sidik rencana beku tidak cocok.");
  return r;
}
