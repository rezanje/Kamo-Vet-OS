import { completeReportQuery } from "./report-query";
import { BATAS_BACA_LAPORAN, petaBerbatas } from "./konkuren-batas";
import { fungsiBelumAda } from "./laporan-struk-kasir";

/**
 * Daftar Anamnesa & Penyakit: rekam medis + kunjungan (cabang, dokter, hewan, pemilik) dari fungsi baca-saja di database
 * (migrasi 20261219100000, berjalan sebagai pemanggil sehingga RLS berlaku persis seperti pembaca lama). Dulu: halaman 500 baris
 * berurutan dengan hitungan pasti di tiap halaman, RLS kunjungan per baris (1-26 Nov ±5.600 baris = 12 halaman).
 * Sekarang satu panggilan per rentang ≤ 31 hari (maks. BATAS_BACA_LAPORAN bersamaan). Pembaca lama hanya dipakai bila fungsinya belum ada
 * atau melewati batas waktu pernyataan.
 */
export const ANAMNESA_RPC = "laporan_anamnesa";
export const HARI_PER_RENTANG_ANAMNESA = 31;
const MAKS_JENDELA = 120; // ±10 tahun; rentang yang lebih panjang (salah ketik) memakai pembaca lama

type Rel<T> = T | T[] | null;
export type RekamMedisAnamnesa = {
  id: string; diagnosis: string | null; anamnesis: string | null;
  gejala_klinis: string | null; follow_up: string | null; created_at: string;
  visits: Rel<{
    branch_id: string | null; dokter: string | null; branches: Rel<{ name: string }>;
    pets: Rel<{ name: string; species: string | null; breed: string | null }>;
    customers: Rel<{ name: string }>;
  }>;
};

type Galat = { message?: string; code?: string } | null;
type KlienRpc = { rpc?: (nama: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: Galat }> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KlienBaca = KlienRpc & { from: (tabel: string) => any };

const melewatiBatasWaktu = (error: NonNullable<Galat>) => error.code === "57014" || /statement timeout/i.test(error.message ?? "");

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const HARI_MS = 86_400_000;
/** Hari ke-n sejak epoch untuk YYYY-MM-DD yang nyata di kalender (null bila bukan tanggal nyata, mis. 2026-13-45). */
function nomorHari(tanggal: string): number | null {
  if (!TANGGAL.test(tanggal)) return null;
  const ms = Date.parse(`${tanggal}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === tanggal ? ms / HARI_MS : null;
}
const keTanggal = (hari: number) => new Date(hari * HARI_MS).toISOString().slice(0, 10);

/**
 * Pecah dari..sampai (YYYY-MM-DD inklusif, tanggal nyata) menjadi jendela ≤ `panjang` hari berurutan tanpa celah/tumpang tindih.
 * Kosong bila masukan bukan tanggal nyata, terbalik, atau lebih dari MAKS_JENDELA jendela (pemanggil memakai pembaca lama).
 */
export function jendelaAnamnesa(dari: string, sampai: string, panjang = HARI_PER_RENTANG_ANAMNESA): { dari: string; sampai: string }[] {
  const a = nomorHari(dari), z = nomorHari(sampai);
  if (a === null || z === null || a > z || (z - a) / panjang > MAKS_JENDELA) return [];
  const hasil: { dari: string; sampai: string }[] = [];
  for (let awal = a; awal <= z; awal += panjang) hasil.push({ dari: keTanggal(awal), sampai: keTanggal(Math.min(awal + panjang - 1, z)) });
  return hasil;
}

/** Pembaca lama (cadangan): halaman 500 baris + hitungan pasti, persis seperti sebelum migrasi 20261219100000. */
export function bacaRekamMedisAnamnesaLama(supabase: KlienBaca, { dari, sampai, cabang }: { dari: string; sampai: string; cabang: string }) {
  const query = supabase.from("medical_records")
    .select(`id, diagnosis, anamnesis, gejala_klinis, follow_up, created_at, visits${cabang ? "!inner" : ""}(branch_id, dokter, branches(name), pets(name, species, breed), customers(name))`, { count: "exact" })
    .gte("created_at", `${dari}T00:00:00+07:00`).lte("created_at", `${sampai}T23:59:59+07:00`);
  return completeReportQuery<RekamMedisAnamnesa>((cabang ? query.eq("visits.branch_id", cabang) : query)
    .order("created_at", { ascending: false }));
}

async function bacaJendela(supabase: KlienRpc, jendela: { dari: string; sampai: string }, cabang: string, ujungEksklusif: string | null): Promise<RekamMedisAnamnesa[] | null> {
  const { data, error } = await supabase.rpc!(ANAMNESA_RPC, {
    p_from: `${jendela.dari}T00:00:00+07:00`,
    // Jendela yang bukan terakhir berakhir tepat di awal jendela berikutnya (eksklusif): tidak ada detik yang jatuh di celah.
    p_to: ujungEksklusif ? `${ujungEksklusif}T00:00:00+07:00` : `${jendela.sampai}T23:59:59+07:00`,
    p_branch_id: cabang || null,
    p_to_eksklusif: ujungEksklusif !== null,
  });
  if (error) {
    if (fungsiBelumAda(error, ANAMNESA_RPC) || melewatiBatasWaktu(error)) return null;
    throw Object.assign(new Error(`Data laporan gagal dibaca: ${error.message}`), { code: error.code });
  }
  const d = data as { n?: unknown; rows?: unknown } | null;
  // Fungsi asli selalu mengembalikan objek { n, rows }. Jawaban lain bukan hasil fungsi ini: pembaca lama yang dipakai.
  if (!d || typeof d !== "object" || Array.isArray(d) || !Array.isArray(d.rows)) return null;
  if (d.n !== d.rows.length) throw new Error("Data laporan gagal dibaca: hitungan rekam medis tidak cocok");
  return d.rows as RekamMedisAnamnesa[];
}

/**
 * Rekam medis pada dari..sampai (tanggal WIB inklusif; sama dengan pembaca lama), urut created_at turun lalu id.
 * Jalur cepat hanya untuk tanggal bentuk YYYY-MM-DD yang urut; selain itu (atau bila fungsi belum ada / melewati batas waktu)
 * pembaca lama dipakai, termasuk pesan galatnya.
 */
export async function bacaRekamMedisAnamnesa(supabase: KlienBaca, masukan: { dari: string; sampai: string; cabang: string }): Promise<{ data: RekamMedisAnamnesa[]; error: null }> {
  const { dari, sampai, cabang } = masukan;
  const jendela = typeof supabase.rpc === "function" ? jendelaAnamnesa(dari, sampai) : [];
  if (jendela.length > 0) {
    const hasil = await petaBerbatas(jendela, BATAS_BACA_LAPORAN, (j, i) =>
      bacaJendela(supabase, j, cabang, i < jendela.length - 1 ? jendela[i + 1].dari : null));
    if (hasil.every((h): h is RekamMedisAnamnesa[] => h !== null)) {
      const semua: RekamMedisAnamnesa[] = [];
      const lihat = new Set<string>();
      // Jendela terbaru lebih dulu: urutan akhir sama dengan ORDER BY created_at DESC, id.
      for (const bagian of [...hasil].reverse()) {
        for (const baris of bagian) {
          if (typeof baris.id !== "string" || !baris.id || lihat.has(baris.id)) throw new Error("Data laporan gagal dibaca: identitas baris laporan tidak lengkap");
          lihat.add(baris.id);
          semua.push(baris);
        }
      }
      return { data: semua, error: null };
    }
  }
  return bacaRekamMedisAnamnesaLama(supabase, masukan);
}
