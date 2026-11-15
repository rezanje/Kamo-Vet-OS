// Baris "Groomer" di header Rekam Medis (baca saja; tidak mengubah data tersimpan).
//
// Latar (Andri, 14 Nov 2026): kunjungan grooming Belang (Panduraya, 10 Nov) didaftarkan sebagai Poli Umum
// dengan dokter, groomer tidak pernah dicatat, dan header Rekam Medis hanya punya kolom "Dokter" — jadi
// groomer tak terlihat walau sudah diisi. Sumber nama: pelaksana kunjungan (`visits.service_provider_id`),
// PJ kunjungan, dan snapshot pelaksana pada baris invoice yang tidak void. Pengelompokan per jabatan memakai
// fungsi cetak yang sama (`petugas-cetak.ts`), jadi header, struk, dan invoice tidak pernah beda nama.

import { isGroomingService } from "./grooming-requirements";
import {
  bacaKartuPetugas, idPetugas, kelompokDariJabatan, petugasPerKelompok,
  type BarisTagihanPetugas, type KartuPetugas, type KunjunganPetugas,
} from "./petugas-cetak";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type KunjunganGroomer = KunjunganPetugas & {
  keluhan?: string | null;
  service_provider_id?: string | null;
  legacy_source_key?: string | null;
  archived_at?: string | null;
};
export type BarisGroomer = BarisTagihanPetugas & {
  deskripsi?: string | null;
  item_type?: string | null;
  tindakan_kategori?: string | null;
};
export type HeaderGroomer = { label: "Groomer" | "Pelaksana"; nama: string | null } | null;

const adalahGrooming = (teks: string | null | undefined) => /grooming/i.test(teks ?? "");
const poliGrooming = (visit: KunjunganGroomer) => (visit.poli ?? "").trim().toLowerCase() === "grooming";

/** Kunjungan tampak seperti grooming: poli Grooming, keluhan menyebut grooming, atau ada layanan grooming di tagihan. */
export function kunjunganTampakGrooming(visit: KunjunganGroomer, lines: readonly BarisGroomer[]): boolean {
  if (poliGrooming(visit) || adalahGrooming(visit.keluhan)) return true;
  // Master jasa grooming di data nyata berkategori "Konsultasi", jadi kategori saja tidak cukup untuk penanda
  // baca-saja ini: jasa yang namanya menyebut grooming juga dihitung (tidak dipakai untuk aturan wajib/penyimpanan).
  return lines.some((line) => isGroomingService(line.item_type, line.tindakan_kategori)
    || (line.item_type === "Jasa" && adalahGrooming(line.deskripsi)));
}

/** Id karyawan yang kartunya perlu dibaca untuk header. */
export function idGroomerKunjungan(visit: KunjunganGroomer, lines: readonly BarisGroomer[]): string[] {
  return [...new Set([...idPetugas([visit], lines), ...(visit.service_provider_id ? [visit.service_provider_id] : [])])];
}

/**
 * Baris header: "Groomer: <nama>", "Pelaksana: <nama>", atau "Groomer: belum diisi" (`nama` null).
 * `null` = tidak tampil (kunjungan bukan grooming dan tidak ada groomer tercatat).
 */
export function headerGroomer(
  visit: KunjunganGroomer,
  lines: readonly BarisGroomer[],
  kartu: ReadonlyMap<string, KartuPetugas>,
): HeaderGroomer {
  const providerId = visit.service_provider_id ?? null;
  const kartuProvider = providerId ? kartu.get(providerId) : undefined;
  const namaProvider = (kartuProvider?.nama ?? "").trim() || null;
  const baris: BarisTagihanPetugas[] = [...lines];
  if (providerId && namaProvider) baris.push({ service_performers: { staff_id: providerId, staff_name: namaProvider } });

  const groomer = [...(petugasPerKelompok(visit, baris, kartu).get("Groomer") ?? [])];
  // Poli Grooming: pelaksana kunjungan yang dipilih di kolom Groomer tetap groomer walau jabatannya tidak terbaca.
  const providerBukanDokter = !!kartuProvider && kelompokDariJabatan(kartuProvider.jabatan) !== "Dokter";
  if (poliGrooming(visit) && namaProvider && providerBukanDokter && !groomer.includes(namaProvider)) groomer.push(namaProvider);
  if (groomer.length) return { label: "Groomer", nama: groomer.join(", ") };

  if (!kunjunganTampakGrooming(visit, lines)) return null;
  // Arsip / riwayat lama tidak bisa diisi lagi: jangan menandai "belum diisi" seolah masih ada yang harus dikerjakan.
  if (visit.archived_at || visit.legacy_source_key) return null;
  // Pelaksana kunjungan terisi tetapi kartunya tidak terbaca: jangan mengaku "belum diisi".
  if (providerId && !kartuProvider) return null;
  if (namaProvider && providerBukanDokter) return { label: "Pelaksana", nama: namaProvider };
  return { label: "Groomer", nama: null };
}

type ItemRef = { item_type: string | null; tindakan_kategori: string | null };
type BarisInvoice = {
  invoice_items?: (BarisTagihanPetugas & { deskripsi?: string | null; items?: ItemRef | ItemRef[] | null })[] | null;
};

/**
 * Baca baris tagihan (tidak void) + kartu karyawan lalu hitung header. Gagal baca = `null` (baris tidak tampil),
 * tidak pernah mengubah atau menggagalkan halaman Rekam Medis.
 */
export async function bacaHeaderGroomer(supabase: AnyClient, visit: KunjunganGroomer & { id: string }): Promise<HeaderGroomer> {
  try {
    const { data, error } = await supabase.from("invoices")
      .select("id, invoice_items(deskripsi, service_performers, items!invoice_items_item_id_fkey(item_type, tindakan_kategori))")
      .eq("visit_id", visit.id).is("voided_at", null);
    if (error) return null;
    const lines: BarisGroomer[] = ((data ?? []) as BarisInvoice[]).flatMap((inv) => (inv.invoice_items ?? []).map((line) => {
      const item = Array.isArray(line.items) ? line.items[0] : line.items;
      return { service_performers: line.service_performers ?? null, deskripsi: line.deskripsi ?? null, item_type: item?.item_type ?? null, tindakan_kategori: item?.tindakan_kategori ?? null };
    }));
    const kartu = await bacaKartuPetugas(supabase, idGroomerKunjungan(visit, lines));
    return headerGroomer(visit, lines, kartu);
  } catch {
    return null;
  }
}
