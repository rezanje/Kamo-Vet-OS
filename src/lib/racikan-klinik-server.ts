import { completeReportQuery } from "./report-query";
import { kunciRacikan } from "./laporan-penjualan-barang";

// Invoice klinik menyimpan racikan sebagai baris obat biasa — tidak ada penanda
// "ini racikan" di barisnya. Satu-satunya cara memisahkannya dari obat ketikan
// adalah mencocokkan nama baris dengan nama resep racikan pada kunjungan yang sama.
//
// Dipakai bersama laporan Penjualan per Barang dan laporan Penjualan per Tenaga
// Penjual supaya kedua laporan menggolongkan baris yang sama ke jenis yang sama.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

function potong<T>(items: T[], ukuran = 100): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < items.length; i += ukuran) hasil.push(items.slice(i, i + ukuran));
  return hasil;
}

/** Kunci `visitId::nama` setiap racikan yang diresepkan pada kunjungan-kunjungan ini. */
export async function namaRacikanPerKunjungan(supabase: AnyClient, visitIds: string[]): Promise<Set<string>> {
  const namaRacikan = new Set<string>();
  const unik = [...new Set(visitIds.filter(Boolean))];
  if (unik.length === 0) return namaRacikan;

  const medicalRecords: { id: string; visit_id: string }[] = [];
  for (const batch of potong(unik)) {
    const { data } = await completeReportQuery(supabase.from("medical_records")
      .select("id, visit_id", { count: "exact" }).in("visit_id", batch));
    medicalRecords.push(...((data ?? []) as { id: string; visit_id: string }[]));
  }
  const visitPerRecord = new Map(medicalRecords.map((record) => [record.id, record.visit_id]));
  for (const batch of potong(medicalRecords.map((record) => record.id))) {
    const { data } = await completeReportQuery(supabase.from("compounding_recipes")
      .select("id, medical_record_id, recipe_name", { count: "exact" }).in("medical_record_id", batch));
    for (const recipe of (data ?? []) as { medical_record_id: string; recipe_name: string }[]) {
      const visitId = visitPerRecord.get(recipe.medical_record_id);
      if (visitId) namaRacikan.add(kunciRacikan(visitId, recipe.recipe_name));
    }
  }
  return namaRacikan;
}
