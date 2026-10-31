// Impor Bagan Akun: baca file → pratinjau lengkap sebelum simpan. Murni, dites di
// __tests__/impor-akun.test.ts. Penyimpanan lewat satu RPC atomik (import_coa_accounts) yang
// mengulang semua pemeriksaan di database; hasil di sini hanya untuk ditinjau pemakai.
//
// Aturan yang dijaga:
//   - kode sumber tidak pernah diubah (nol depan, titik, strip tetap apa adanya). Kode yang tidak
//     cocok kontrak KAMO menjadi KONFLIK beserta solusinya, bukan diperbaiki diam-diam;
//   - satu file = satu keputusan: ada baris ditolak/konflik → tidak ada yang disimpan;
//   - kode yang sudah ada tidak membuat duplikat; perbedaannya tampil sebagai diff dan baru
//     diterapkan bila pemakai mencentang konfirmasi;
//   - kolom saldo dipisahkan dan TIDAK diimpor — impor master tidak membuat saldo/jurnal.
// Validator akun & pohon memakai yang sudah ada (coa-sistem, coa-pohon), tidak disalin.

import { bacaCsvUmum, pecahBaris, tebakPemisah } from "./impor-csv";
import {
  KODE_SISTEM, SISI_WAJAR, TIPE_AKUN, akunSistem, alasanTakBolehNonaktif, tipeDariKode,
  validasiAkunBaru, validasiSisiSaldo, validasiUbahAkun, type PemakaiAkun, type TipeAkun,
} from "./coa-sistem";
import { validasiIndukAkun, type AkunPohon } from "./coa-pohon";
import {
  KOLOM_AKUN_WAJIB, type KolomAkun, type PemetaanTemplateAkun, type PemetaanTerblokirAkun,
} from "./impor-akun-pemetaan";

export const MAKS_BARIS_AKUN = 1000;

export type AkunAda = {
  id: string; code: string; name: string; type: string; normal_balance: string;
  is_header: boolean; is_active: boolean; parent_id: string | null;
};
export type KonteksImporAkun = {
  /** sidik jari seluruh bagan akun saat dibaca; simpan ditolak bila sudah berubah */
  versi: string;
  akun: AkunAda[];
  /** per kode akun; kode yang tidak tercantum berarti belum dipakai apa pun */
  pemakaian: Record<string, PemakaiAkun>;
};

export type StatusBaris = "baru" | "sama" | "berubah" | "konflik" | "ditolak";
export type PerubahanKolom = { kolom: "nama" | "tipe" | "saldo_normal" | "header" | "induk" | "aktif"; lama: string; baru: string };
export type BarisRencana = {
  no: number; kode: string; nama: string; tipe: string; induk: string;
  status: StatusBaris; alasan: string[]; solusi: string | null; perubahan: PerubahanKolom[];
};
/** Bentuk yang dikirim ke RPC import_coa_accounts. */
export type BarisKirim = {
  code: string; name: string; type: string; normal_balance: "D" | "K"; is_header: boolean;
  /** null = status aktif akun lama tidak diubah */
  is_active: boolean | null;
  set_parent: boolean; parent_code: string | null;
};
export type JumlahRencana = Record<StatusBaris, number> & { total: number };
export type RencanaImporAkun = {
  baris: BarisRencana[];
  jumlah: JumlahRencana;
  kolomDipetakan: { sumber: string; tujuan: KolomAkun }[];
  kolomDiabaikan: string[];
  kolomSaldo: string[];
  barisBersaldo: number;
  kirim: BarisKirim[];
  bolehSimpan: boolean;
  perluKonfirmasi: boolean;
  versi: string;
};

// ── Membaca file ──────────────────────────────────────────────────────────────

type BarisFile = { no: number; data: Partial<Record<KolomAkun, string>>; bersaldo: boolean };
export type FileAkun =
  | { ok: false; pesan: string }
  | {
      ok: true; baris: BarisFile[]; kolomAda: Set<KolomAkun>;
      kolomDipetakan: { sumber: string; tujuan: KolomAkun }[];
      kolomDiabaikan: string[]; kolomSaldo: string[]; barisBersaldo: number;
    };

/** Judul kolom yang memuat angka saldo/nilai. Dipisahkan, tidak pernah dibukukan dari sini. */
const KOLOM_BERNILAI = /saldo|balance|debit|debet|kredit|credit|nominal|amount|jumlah|nilai/;

export function bacaFileAkun(isi: string, pemetaan: PemetaanTemplateAkun): FileAkun {
  const mentah = bacaCsvUmum(isi, [], []);
  if (!mentah.ok) return mentah;
  if (mentah.baris.length > MAKS_BARIS_AKUN) {
    return { ok: false, pesan: `File berisi ${mentah.baris.length} baris — maksimal ${MAKS_BARIS_AKUN} akun per impor. Pecah filenya.` };
  }

  const judul = Object.keys(mentah.baris[0].data);
  const kolomDipetakan: { sumber: string; tujuan: KolomAkun }[] = [];
  const kolomDiabaikan: string[] = [];
  const kolomSaldo: string[] = [];
  for (const sumber of judul) {
    const tujuan = Object.prototype.hasOwnProperty.call(pemetaan.kolom, sumber) ? pemetaan.kolom[sumber] : undefined;
    if (tujuan) {
      const ganda = kolomDipetakan.find((k) => k.tujuan === tujuan);
      if (ganda) return { ok: false, pesan: `Kolom "${ganda.sumber}" dan "${sumber}" sama-sama dipetakan ke ${tujuan}. Sisakan satu.` };
      kolomDipetakan.push({ sumber, tujuan });
    } else if (KOLOM_BERNILAI.test(sumber)) kolomSaldo.push(sumber);
    else kolomDiabaikan.push(sumber);
  }

  const kolomAda = new Set(kolomDipetakan.map((k) => k.tujuan));
  const kurang = KOLOM_AKUN_WAJIB.filter((k) => !kolomAda.has(k));
  if (kurang.length > 0) return { ok: false, pesan: `Kolom wajib belum ada di file: ${kurang.join(", ")}.` };

  let barisBersaldo = 0;
  const baris = mentah.baris.map((b) => {
    const data: Partial<Record<KolomAkun, string>> = {};
    for (const { sumber, tujuan } of kolomDipetakan) data[tujuan] = (b.data[sumber] ?? "").trim();
    if (data.tipe !== undefined) {
      const t = data.tipe.toUpperCase();
      data.tipe = pemetaan.tipe[t] ?? t;
    }
    const bersaldo = kolomSaldo.some((k) => /[1-9]/.test(b.data[k] ?? ""));
    if (bersaldo) barisBersaldo++;
    return { no: b.no, data, bersaldo };
  });

  return { ok: true, baris, kolomAda, kolomDipetakan, kolomDiabaikan, kolomSaldo, barisBersaldo };
}

// ── Pratinjau ─────────────────────────────────────────────────────────────────

const TANPA_PEMAKAIAN: PemakaiAkun = { jurnal: 0, rekeningKas: false, kategoriAset: false, jurnalBerulang: false };
const YA = ["ya", "y", "1", "true"];
const TIDAK = ["tidak", "t", "n", "no", "0", "false"];
const yaTidak = (v: boolean) => (v ? "ya" : "tidak");
const TETAP_KODE = "Sistem tidak mengubah kode sendiri.";

function bacaPilihan(v: string, ya: string[], tidak: string[]): boolean | null | "salah" {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (ya.includes(t)) return true;
  if (tidak.includes(t)) return false;
  return "salah";
}

function bacaSaldo(v: string): "D" | "K" | null | "salah" {
  const t = v.trim().toUpperCase();
  if (!t) return null;
  if (t === "D" || t === "DEBIT") return "D";
  if (t === "K" || t === "KREDIT") return "K";
  return "salah";
}

/** Kode baru vs kontrak kode KAMO → konflik + solusi, atau null kalau cocok. */
function konflikKodeBaru(kode: string, nama: string, tipe: TipeAkun, normal: "D" | "K"): { alasan: string; solusi: string } | null {
  const solusiFormat = `Ubah kode di file sesuai bagan akun KAMO (6 angka: 1–2 Aset, 3 Liabilitas, 4 Ekuitas, 5 Pendapatan, 6–7 Beban, 81 Pendapatan / 82 Beban di luar operasional), atau tunggu pemetaan kode yang sudah ditinjau. ${TETAP_KODE}`;
  if (/^\d{6}$/.test(kode) && !tipeDariKode(kode)) {
    return { alasan: `Kode ${kode} tidak termasuk kelompok mana pun di bagan akun KAMO.`, solusi: solusiFormat };
  }
  const pesan = validasiAkunBaru({ code: kode, name: nama, type: tipe, normal_balance: normal });
  if (!pesan) return null;
  if (!/^\d{6}$/.test(kode)) return { alasan: pesan, solusi: solusiFormat };
  if (tipeDariKode(kode) !== tipe) {
    return { alasan: pesan, solusi: `Samakan tipe dengan kelompok kode, atau ubah kode di file. ${TETAP_KODE}` };
  }
  if (akunSistem(kode)) return { alasan: pesan, solusi: `Pakai kode lain untuk akun ini. ${TETAP_KODE}` };
  return { alasan: pesan, solusi: `Rekening kas/bank dibuat dari menu Kas & Bank → Rekening; untuk akun biasa pakai kode lain. ${TETAP_KODE}` };
}

function alasanTerlindung(kode: string, p: PemakaiAkun): string | null {
  if (akunSistem(kode)) return `dipakai sistem untuk ${KODE_SISTEM[kode]}`;
  if (p.jurnal > 0) return "sudah punya jurnal";
  if (p.rekeningKas) return "adalah akun sebuah rekening kas/bank";
  if (p.kategoriAset) return "dipakai kategori aset untuk jurnal penyusutan";
  if (p.jurnalBerulang) return "dipakai jurnal berulang yang masih aktif";
  return null;
}

type Kerja = {
  b: BarisRencana;
  sah: boolean;
  tolak: string[];
  konflik: { alasan: string; solusi: string }[];
  lama: AkunAda | null;
  akhir: { name: string; type: TipeAkun; normal: "D" | "K"; is_header: boolean; parent: string | null };
  aktif: boolean | null;
  setInduk: boolean;
};

export function rencanakanImporAkun(file: Extract<FileAkun, { ok: true }>, ctx: KonteksImporAkun): RencanaImporAkun {
  const adaPerKode = new Map(ctx.akun.map((a) => [a.code, a]));
  const kodePerId = new Map(ctx.akun.map((a) => [a.id, a.code]));
  const pakai = (kode: string) => ctx.pemakaian[kode] ?? TANPA_PEMAKAIAN;
  const indukLama = (a: AkunAda) => (a.parent_id ? kodePerId.get(a.parent_id) ?? null : null);

  const kerja: Kerja[] = [];
  const barisKode = new Map<string, number>();

  // 1. Tiap baris berdiri sendiri: isian wajib, nilai yang dikenal, kode kembar, kontrak kode.
  for (const { no, data } of file.baris) {
    const kode = data.kode ?? "";
    const nama = data.nama ?? "";
    const tipeTeks = data.tipe ?? "";
    const induk = file.kolomAda.has("induk") ? (data.induk ?? "") : "";
    const b: BarisRencana = { no, kode, nama, tipe: tipeTeks, induk, status: "baru", alasan: [], solusi: null, perubahan: [] };
    const w: Kerja = {
      b, sah: false, tolak: [], konflik: [], lama: null, aktif: null, setInduk: file.kolomAda.has("induk"),
      akhir: { name: nama, type: "ASET", normal: "D", is_header: false, parent: induk || null },
    };
    kerja.push(w);

    if (!kode) { w.tolak.push("Kode akun kosong."); continue; }
    if (barisKode.has(kode)) { w.tolak.push(`Kode kembar di dalam file ini (sudah ada di baris ${barisKode.get(kode)}).`); continue; }
    barisKode.set(kode, no);

    if (!nama) w.tolak.push("Nama akun kosong.");
    else if (nama.length > 80) w.tolak.push(`Nama akun ${nama.length} huruf — maksimal 80. Pendekkan di file; sistem tidak memotongnya sendiri.`);
    if (!(TIPE_AKUN as readonly string[]).includes(tipeTeks)) {
      w.tolak.push(`Tipe "${tipeTeks || "(kosong)"}" tidak dikenal (isi: ${TIPE_AKUN.join(" / ")}).`);
    }
    const saldo = bacaSaldo(data.saldo_normal ?? "");
    if (saldo === "salah") w.tolak.push(`Saldo normal "${data.saldo_normal}" harus D atau K.`);
    // Kolom header ada di file → isinya berlaku (kosong = akun detail); kolomnya tidak ada → akun lama tidak diubah.
    const header = file.kolomAda.has("header") ? bacaPilihan(data.header ?? "", [...YA, "header"], [...TIDAK, "detail"]) ?? false : null;
    if (header === "salah") w.tolak.push(`Nilai header "${data.header}" tidak dikenal (isi: ya / tidak).`);
    const aktif = bacaPilihan(data.aktif ?? "", [...YA, "aktif"], [...TIDAK, "nonaktif"]);
    if (aktif === "salah") w.tolak.push(`Nilai aktif "${data.aktif}" tidak dikenal (isi: ya / tidak).`);
    if (w.tolak.length > 0) continue;

    const tipe = tipeTeks as TipeAkun;
    const lama = adaPerKode.get(kode) ?? null;
    w.lama = lama;
    w.aktif = aktif as boolean | null;
    w.sah = true;

    if (!lama) {
      const normal = (saldo as "D" | "K" | null) ?? SISI_WAJAR[tipe];
      w.akhir = { name: nama, type: tipe, normal, is_header: (header as boolean | null) ?? false, parent: induk || null };
      const sisi = validasiSisiSaldo(tipe, normal, kode);
      if (sisi) { w.tolak.push(sisi); continue; }
      const k = konflikKodeBaru(kode, nama, tipe, normal);
      if (k) w.konflik.push(k);
      continue;
    }

    // Kode sudah ada: bandingkan, jangan timpa.
    const p = pakai(kode);
    const normal = (saldo as "D" | "K" | null) ?? (lama.normal_balance as "D" | "K");
    const isHeader = (header as boolean | null) ?? lama.is_header;
    const parent = w.setInduk ? induk || null : indukLama(lama);
    w.akhir = { name: nama, type: tipe, normal, is_header: isHeader, parent };

    const ubah = b.perubahan;
    if (nama !== lama.name) ubah.push({ kolom: "nama", lama: lama.name, baru: nama });
    if (tipe !== lama.type) ubah.push({ kolom: "tipe", lama: lama.type, baru: tipe });
    if (normal !== lama.normal_balance) ubah.push({ kolom: "saldo_normal", lama: lama.normal_balance, baru: normal });
    if (isHeader !== lama.is_header) ubah.push({ kolom: "header", lama: yaTidak(lama.is_header), baru: yaTidak(isHeader) });
    if (parent !== indukLama(lama)) ubah.push({ kolom: "induk", lama: indukLama(lama) ?? "", baru: parent ?? "" });
    if (aktif !== null && aktif !== lama.is_active) ubah.push({ kolom: "aktif", lama: yaTidak(lama.is_active), baru: yaTidak(aktif as boolean) });
    if (ubah.length === 0) continue;

    const kelompokBerubah = tipe !== lama.type || normal !== lama.normal_balance;
    if (kelompokBerubah) {
      const sisi = validasiSisiSaldo(tipe, normal, kode);
      if (sisi) { w.tolak.push(sisi); continue; }
      const pesan = validasiUbahAkun({ code: kode, name: nama, type: tipe, normal_balance: normal }, lama, p.jurnal > 0);
      const terlindung = alasanTerlindung(kode, p);
      if (pesan) {
        w.konflik.push({ alasan: pesan, solusi: "Samakan kelompok/saldo normal di file dengan yang ada di KAMO, atau buat akun baru dengan kode lain." });
      } else if (terlindung) {
        w.konflik.push({
          alasan: `Akun ${kode} ${terlindung} — kelompok & saldo normalnya tidak boleh diubah lewat impor.`,
          solusi: "Samakan kelompok/saldo normal di file dengan yang ada di KAMO.",
        });
      }
    }
    if (nama !== lama.name && p.rekeningKas) {
      w.konflik.push({
        alasan: `Akun ${kode} adalah akun sebuah rekening kas/bank — namanya juga tercatat di daftar rekening.`,
        solusi: "Ganti nama lewat menu Kas & Bank → Rekening, atau samakan nama di file dengan yang ada di KAMO.",
      });
    }
    if (aktif === false && lama.is_active) {
      const alasan = alasanTakBolehNonaktif(kode, p);
      if (alasan) w.konflik.push({ alasan, solusi: "Kosongkan kolom aktif (atau isi ya) untuk akun ini." });
    }
  }

  // 2. Struktur pohon atas keadaan AKHIR (bagan akun sekarang + isi file): induk boleh di
  //    bawah anaknya di file, tetapi harus ada, berupa akun induk, sekelompok, dan tidak melingkar.
  const akhir = new Map<string, { type: string; is_header: boolean; parent: string | null; name: string }>();
  for (const a of ctx.akun) akhir.set(a.code, { type: a.type, is_header: a.is_header, parent: indukLama(a), name: a.name });
  const diFile = new Set<string>();
  for (const w of kerja) {
    if (!w.sah) continue;
    diFile.add(w.b.kode);
    akhir.set(w.b.kode, { type: w.akhir.type, is_header: w.akhir.is_header, parent: w.akhir.parent, name: w.akhir.name });
  }
  const pohon: AkunPohon[] = [...akhir].map(([code, a]) => ({ id: code, code, name: a.name, type: a.type, parent_id: a.parent, is_header: a.is_header }));
  const punyaAnak = new Set(pohon.filter((a) => a.parent_id && a.parent_id !== a.id).map((a) => a.parent_id as string));

  const rantaiMelingkar = (kode: string): string[] | null => {
    const lewat: string[] = [];
    let kini: string | null = kode;
    while (kini) {
      const ke = lewat.indexOf(kini);
      if (ke >= 0) return [...lewat.slice(ke), kini];
      lewat.push(kini);
      const berikut: string | null = akhir.get(kini)?.parent ?? null;
      if (berikut === kini) return kini === kode ? null : [kini, kini]; // induk diri sendiri → pesan khusus di bawah
      kini = berikut;
    }
    return null;
  };

  for (const w of kerja) {
    if (!w.sah || w.tolak.length > 0) continue;
    if (w.lama && w.b.perubahan.length === 0) continue; // tidak berubah → tidak diperiksa ulang
    const kode = w.b.kode;
    const { type, is_header, parent } = w.akhir;

    const siklus = rantaiMelingkar(kode);
    if (siklus) { w.tolak.push(`Induk melingkar: ${siklus.join(" → ")}.`); continue; }
    if (parent && parent !== kode && !akhir.has(parent)) {
      w.tolak.push(`Induk ${parent} tidak ada di file maupun di bagan akun.`);
      continue;
    }
    const pesan = validasiIndukAkun(
      { id: kode, type, parent_id: parent, is_header }, pohon,
      { punyaJurnal: pakai(kode).jurnal > 0, punyaAnak: punyaAnak.has(kode) },
    );
    if (pesan) { w.tolak.push(pesan); continue; }
    // Rincian lama yang tidak ada di file tetap di bawah akun ini — kelompoknya harus ikut sama.
    const anakBeda = pohon.find((a) => a.parent_id === kode && !diFile.has(a.code) && a.type !== type);
    if (anakBeda) {
      w.tolak.push(`Akun ${anakBeda.code} (${anakBeda.type}) masih di bawah akun ini — kelompok induk dan rinciannya harus sama.`);
    }
  }

  // 3. Status akhir & data yang dikirim.
  const kirim: BarisKirim[] = [];
  for (const w of kerja) {
    const b = w.b;
    if (w.tolak.length > 0) { b.status = "ditolak"; b.alasan = w.tolak; b.solusi = null; continue; }
    if (w.konflik.length > 0) {
      b.status = "konflik"; b.alasan = w.konflik.map((k) => k.alasan); b.solusi = w.konflik[0].solusi; continue;
    }
    if (w.lama) {
      b.status = b.perubahan.length > 0 ? "berubah" : "sama";
      if (b.status === "sama") continue;
      kirim.push({
        code: b.kode, name: w.akhir.name, type: w.akhir.type, normal_balance: w.akhir.normal, is_header: w.akhir.is_header,
        is_active: w.aktif, set_parent: w.setInduk, parent_code: w.setInduk ? w.akhir.parent : null,
      });
    } else {
      b.status = "baru";
      kirim.push({
        code: b.kode, name: w.akhir.name, type: w.akhir.type, normal_balance: w.akhir.normal, is_header: w.akhir.is_header,
        is_active: w.aktif ?? true, set_parent: !!w.akhir.parent, parent_code: w.akhir.parent,
      });
    }
  }

  const jumlah: JumlahRencana = { total: kerja.length, baru: 0, sama: 0, berubah: 0, konflik: 0, ditolak: 0 };
  for (const w of kerja) jumlah[w.b.status]++;

  return {
    baris: kerja.map((w) => w.b),
    jumlah,
    kolomDipetakan: file.kolomDipetakan,
    kolomDiabaikan: file.kolomDiabaikan,
    kolomSaldo: file.kolomSaldo,
    barisBersaldo: file.barisBersaldo,
    kirim,
    bolehSimpan: jumlah.ditolak === 0 && jumlah.konflik === 0 && jumlah.baru + jumlah.berubah > 0,
    perluKonfirmasi: jumlah.berubah > 0,
    versi: ctx.versi,
  };
}

// ── File COA pengguna (struktur ditinjau, simpan dimatikan) ───────────────────────
//
// Kolomnya hanya Kode | Nama Akun | Normal. Tipe/kelompok, induk dan header/posting TIDAK ada,
// jadi tidak ada yang bisa disimpan: semua baris dipratinjau dengan asal sheet+barisnya, kode kembar
// ditahan, dan usulan kelompok dari digit pertama hanya ditampilkan (tidak pernah dipakai).

export const MAKS_BARIS_TABEL = 5000;
export type BarisTabel = { no: number; sel: string[] };
/** Isi mentah satu sheet/CSV: SEMUA baris dari baris 1, termasuk yang kosong, dengan nomor aslinya. */
export type TabelSumber = { sheet: string; baris: BarisTabel[] };

export function bacaTabelCsv(isi: string): TabelSumber {
  const bersih = isi.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const pemisah = tebakPemisah(bersih);
  const baris = bersih.split("\n").slice(0, MAKS_BARIS_TABEL + 1)
    .map((teks, i) => ({ no: i + 1, sel: teks.trim() ? pecahBaris(teks, pemisah) : [] }));
  return { sheet: "CSV", baris };
}

export type StatusCoaPengguna = "menunggu_pemetaan" | "sudah_ada" | "ditahan" | "konflik" | "ditolak";
export type BarisCoaPengguna = {
  sumber: { sheet: string; baris: number };
  kode: string; nama: string;
  /** nilai Normal persis dari file — belum ditinjau Finance */
  normalSumber: string;
  status: StatusCoaPengguna; alasan: string[]; solusi: string | null;
  /** kelompok yang DIUSULKAN aturan kode KAMO (digit pertama). Bukan keputusan; tidak dipakai menyimpan. */
  usulanKelompok: TipeAkun | null;
  catatanNormal: string | null;
  perubahan: PerubahanKolom[];
};
export type JumlahCoaPengguna = Record<StatusCoaPengguna, number> & { totalData: number };
export type RencanaCoaPenggunaOk = {
  ok: true; profil: string; sheet: string; barisJudul: number;
  pembuka: { baris: number; alasan: string }[];
  kosong: { baris: number; alasan: string }[];
  kolomDipetakan: { sumber: string; tujuan: KolomAkun }[];
  kolomDiabaikan: string[]; kolomSaldo: string[];
  baris: BarisCoaPengguna[];
  jumlah: JumlahCoaPengguna;
  kodeUnik: number;
  normalSumber: Record<string, number>;
  catatanUsulan: string;
  terblokir: string[];
  bolehSimpan: false;
  versi: string;
};
export type RencanaCoaPengguna = { ok: false; pesan: string } | RencanaCoaPenggunaOk;

export function rencanakanCoaPengguna(tabel: TabelSumber, p: PemetaanTerblokirAkun, ctx: KonteksImporAkun): RencanaCoaPengguna {
  if (tabel.baris.length > MAKS_BARIS_TABEL) return { ok: false, pesan: `File lebih dari ${MAKS_BARIS_TABEL} baris.` };

  // Baris judul dicari dengan teks PERSIS, bukan ditebak dari posisinya.
  let judul = -1;
  let posisi: number[] = [];
  for (let i = 0; i < Math.min(p.cariJudulSampai, tabel.baris.length) && judul < 0; i++) {
    const sel = tabel.baris[i].sel.map((x) => x.trim());
    const idx = p.judul.map((j) => sel.indexOf(j.teks));
    if (p.judul.every((j, k) => idx[k] >= 0 && sel.lastIndexOf(j.teks) === idx[k])) { judul = i; posisi = idx; }
  }
  if (judul < 0) {
    return {
      ok: false,
      pesan: `Judul kolom persis "${p.judul.map((j) => j.teks).join(" | ")}" tidak ditemukan di ${p.cariJudulSampai} baris teratas` +
        `${tabel.sheet === "CSV" ? "" : ` sheet ${tabel.sheet}`}. File ini tidak sesuai format ${p.label}.`,
    };
  }
  const barisJudul = tabel.baris[judul].no;
  const kolomDipetakan = p.judul.map((j) => ({ sumber: j.teks, tujuan: j.ke }));
  const kolomDiabaikan: string[] = [];
  const kolomSaldo: string[] = [];
  tabel.baris[judul].sel.map((x) => x.trim()).forEach((h, i) => {
    if (!h || posisi.includes(i)) return;
    (KOLOM_BERNILAI.test(h.toLowerCase()) ? kolomSaldo : kolomDiabaikan).push(h);
  });
  const ke = (kolom: KolomAkun) => posisi[p.judul.findIndex((j) => j.ke === kolom)];

  const pembuka = tabel.baris.slice(0, judul)
    .map((b) => ({ baris: b.no, alasan: `Baris pembuka sebelum judul kolom (baris ${barisJudul}) — dilewati.` }));
  const kosong: { baris: number; alasan: string }[] = [];
  const data: { no: number; kode: string; nama: string; normal: string }[] = [];
  for (const b of tabel.baris.slice(judul + 1)) {
    if (b.sel.every((x) => !x.trim())) { kosong.push({ baris: b.no, alasan: "Baris kosong dilewati." }); continue; }
    const ambil = (k: KolomAkun) => (b.sel[ke(k)] ?? "").trim();
    data.push({ no: b.no, kode: ambil("kode"), nama: ambil("nama"), normal: ambil("saldo_normal") });
  }
  // Baris kosong di ujung file (sesudah data terakhir) bukan baris data yang hilang.
  const terakhir = data.at(-1)?.no ?? barisJudul;
  while (kosong.length && kosong[kosong.length - 1].baris > terakhir) kosong.pop();

  const perKode = new Map<string, typeof data>();
  for (const d of data) if (d.kode) perKode.set(d.kode, [...(perKode.get(d.kode) ?? []), d]);
  const adaPerKode = new Map(ctx.akun.map((a) => [a.code, a]));
  const punya = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

  const baris: BarisCoaPengguna[] = data.map((d) => {
    const usulan = tipeDariKode(d.kode);
    const sisi = punya(p.normal, d.normal) ? p.normal[d.normal] : null;
    const b: BarisCoaPengguna = {
      sumber: { sheet: tabel.sheet, baris: d.no }, kode: d.kode, nama: d.nama, normalSumber: d.normal,
      status: "menunggu_pemetaan", alasan: [], solusi: null, usulanKelompok: usulan, perubahan: [],
      catatanNormal: usulan && sisi && sisi !== SISI_WAJAR[usulan]
        ? `Normal sumber ${d.normal} berbeda dari sisi wajar kelompok usulan ${usulan} (${SISI_WAJAR[usulan] === "D" ? "Debit" : "Kredit"}) — perlu tinjauan Finance (bisa akun kontra).`
        : null,
    };
    const kembar = d.kode ? perKode.get(d.kode)! : [];
    if (kembar.length > 1) {
      const namaBeda = new Set(kembar.map((k) => k.nama)).size;
      const daftar = kembar.slice(0, 8).map((k) => k.no).join(", ") + (kembar.length > 8 ? ", …" : "");
      b.status = "ditahan";
      b.alasan = [`Kode ${d.kode} muncul di ${kembar.length} baris (baris ${daftar}) dengan ${namaBeda} nama berbeda. ` +
        "Ditahan: tidak digabung, tidak ditimpa, dan tidak diberi nomor baru otomatis."];
      b.solusi = "Finance/pemilik menentukan kode yang benar untuk tiap nama, lalu perbaiki di file.";
      return b;
    }
    const tolak = (alasan: string) => { b.status = "ditolak"; b.alasan = [alasan]; return b; };
    if (!d.kode) return tolak("Kode akun kosong.");
    if (!d.nama) return tolak("Nama akun kosong.");
    if (d.nama.length > 80) return tolak(`Nama akun ${d.nama.length} huruf — maksimal 80.`);
    if (!sisi) return tolak(`Normal "${d.normal || "(kosong)"}" tidak dikenal (isi: ${Object.keys(p.normal).join(" / ")}).`);
    if (!/^\d{4,6}$/.test(d.kode) || !usulan) {
      b.status = "konflik";
      b.alasan = [`Kode ${d.kode} tidak cocok bagan akun KAMO (6 angka; kode lama 4–5 angka berawalan 1–5).`];
      b.solusi = `Ubah kode di file, atau putuskan aturan padanan kode yang ditinjau. ${TETAP_KODE}`;
      return b;
    }
    const lama = adaPerKode.get(d.kode);
    if (lama) {
      b.status = "sudah_ada";
      if (d.nama !== lama.name) b.perubahan.push({ kolom: "nama", lama: lama.name, baru: d.nama });
      if (sisi !== lama.normal_balance) b.perubahan.push({ kolom: "saldo_normal", lama: lama.normal_balance, baru: sisi });
      b.alasan = [b.perubahan.length
        ? "Kode sudah ada di bagan akun KAMO; perbedaannya hanya ditampilkan, tidak diterapkan."
        : "Kode sudah ada di bagan akun KAMO dengan nama & Normal sama."];
      return b;
    }
    b.alasan = ["Menunggu keputusan kelompok, induk dan header/posting — belum bisa disimpan."];
    return b;
  });

  const jumlah: JumlahCoaPengguna = { totalData: baris.length, menunggu_pemetaan: 0, sudah_ada: 0, ditahan: 0, konflik: 0, ditolak: 0 };
  for (const b of baris) jumlah[b.status]++;
  const normalSumber: Record<string, number> = Object.fromEntries([...Object.keys(p.normal), "lain"].map((k) => [k, 0]));
  for (const d of data) normalSumber[punya(p.normal, d.normal) ? d.normal : "lain"]++;

  return {
    ok: true, profil: p.label, sheet: tabel.sheet, barisJudul, pembuka, kosong, kolomDipetakan, kolomDiabaikan, kolomSaldo,
    baris, jumlah, kodeUnik: perKode.size, normalSumber,
    catatanUsulan: "Kolom kelompok berisi usulan dari digit pertama kode menurut aturan KAMO — belum disetujui dan tidak dipakai untuk menyimpan.",
    terblokir: p.terblokir, bolehSimpan: false, versi: ctx.versi,
  };
}
