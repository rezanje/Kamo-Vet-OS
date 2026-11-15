// Marketing: Follow up pelanggan. Bagian MURNI (tanpa database): nomor HP, tautan WhatsApp, saringan URL, pengelompokan.
// Semua aturan hitung (siapa "lama tidak balik", grooming, hari ini) ada di fungsi database `marketing_followup_daftar`
// dan dibuktikan lewat uji PostgreSQL. Di sini hanya yang dipakai tampilan.

export const FUNGSI_DAFTAR = "marketing_followup_daftar";
export const FUNGSI_RINGKAS = "marketing_followup_ringkas";
export const FUNGSI_CATAT = "marketing_log_contact";
export const FUNGSI_BOLEH = "marketing_followup_allowed";
export const HALAMAN_FOLLOWUP = "/crm/follow-up";
export const ID_SUBMENU_FOLLOWUP = "crm.follow-up-pelanggan";

export const TAB_FOLLOWUP = [
  { id: "lama", label: "Lama tidak balik", jenis: "lama_tidak_balik" },
  { id: "grooming", label: "Grooming", jenis: "grooming" },
  { id: "hari_ini", label: "Hari ini", jenis: "followup_klinik" },
  { id: "baru", label: "Pelanggan baru", jenis: "baru_belum_balik" },
] as const;
export type TabId = (typeof TAB_FOLLOWUP)[number]["id"];
export type JenisLog = (typeof TAB_FOLLOWUP)[number]["jenis"];

export const PERIODE_LAMA = [60, 90, 180] as const;
export const INTERVAL_GROOMING = [21, 30, 45] as const;
export const DEPAN_PILIHAN = [0, 1, 3, 7] as const;
export const MASA_TUNGGU_PILIHAN = [7, 14, 30] as const;
export const HASIL_KONTAK = ["Tertarik", "Tidak diangkat", "Nanti", "Tidak berminat", "Nomor salah"] as const;
export type HasilKontak = (typeof HASIL_KONTAK)[number];
export const STATUS_KONTAK = [
  { id: "belum", label: "Belum dihubungi" },
  { id: "sudah", label: "Sudah dihubungi" },
  { id: "semua", label: "Semua" },
] as const;
export type StatusKontak = (typeof STATUS_KONTAK)[number]["id"];
export const BATAS_CATATAN = 500;
export const BATAS_BARIS_CABANG = 200;
export const LABEL_TANPA_CABANG = "Tanpa cabang (riwayat impor)";
/** Penjualan rinci tercatat sejak tanggal ini; sebelumnya hanya kunjungan klinik hasil impor. */
export const KETERANGAN_RIWAYAT = "Riwayat belanja rinci baru ada sejak 1 Nov 2026; pengingat lebih akurat seiring waktu.";

/** Nomor HP Indonesia -> 62xxxxxxxxxx (10-14 digit, mulai 628) atau null. HARUS sama dengan public.marketing_normalisasi_hp (kasus uji dipakai bersama). */
export function normalisasiHp(input: string | null | undefined): string | null {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("620")) d = "62" + d.slice(3);
  else if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return /^628[0-9]{7,11}$/.test(d) ? d : null;
}

export type JenisPesan = TabId;
export type KonteksPesan = { pemilik: string; hewan?: string[]; klinik?: string | null };

function sapaan(nama: string): string {
  const bersih = nama.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return bersih ? `Kak ${bersih}` : "Kak";
}
function sebutHewan(hewan: string[] | undefined): string {
  const nama = (hewan ?? []).map(h => h.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  if (nama.length === 0) return "anabulnya";
  if (nama.length === 1) return nama[0];
  return nama.slice(0, -1).join(", ") + " dan " + nama[nama.length - 1];
}

/** Pesan pembuka singkat dan sopan; staf boleh mengubahnya di WhatsApp sebelum mengirim. Tidak pernah terkirim otomatis. */
export function pesanWhatsapp(jenis: JenisPesan, k: KonteksPesan): string {
  const salam = `Halo ${sapaan(k.pemilik)}`;
  const hewan = sebutHewan(k.hewan);
  const penutup = k.klinik?.trim() ? ` Terima kasih. — ${k.klinik.trim().slice(0, 60)}` : " Terima kasih.";
  switch (jenis) {
    case "grooming":
      return `${salam}, ini dari Kamo Pets. ${hewan} sudah waktunya grooming lagi. Mau kami jadwalkan?${penutup}`;
    case "hari_ini":
      return `${salam}, ini dari Kamo Pets. Kami ingin mengingatkan jadwal kontrol/perawatan ${hewan}. Boleh dibalas untuk atur jadwalnya?${penutup}`;
    case "baru":
      return `${salam}, ini dari Kamo Pets. Terima kasih sudah berkunjung. Bagaimana kabar ${hewan}? Kalau ada yang bisa kami bantu, kabari ya.${penutup}`;
    default:
      return `${salam}, ini dari Kamo Pets. Sudah lama tidak berjumpa dengan ${hewan}. Bagaimana kabarnya? Kami siap membantu kalau ada keperluan.${penutup}`;
  }
}

/** Tautan wa.me. Hanya nomor 62 yang sah; pesan di-encode penuh (tidak ada tanda & ? # yang lolos). null bila nomor tidak sah. */
export function tautanWhatsapp(nomor: string | null | undefined, pesan: string): string | null {
  const wa = normalisasiHp(nomor);
  if (!wa) return null;
  return `https://wa.me/${wa}?text=${encodeURIComponent(pesan)}`;
}

export const adalahTab = (v: unknown): v is TabId => TAB_FOLLOWUP.some(t => t.id === v);
export const jenisLogDari = (tab: TabId): JenisLog => TAB_FOLLOWUP.find(t => t.id === tab)!.jenis;

export type FilterFollowUp = {
  tab: TabId; hari: (typeof PERIODE_LAMA)[number]; interval: (typeof INTERVAL_GROOMING)[number]; depan: (typeof DEPAN_PILIHAN)[number];
  cooldown: number; status: StatusKontak; cabang: string; cari: string;
};
export const FILTER_AWAL: FilterFollowUp = { tab: "lama", hari: 90, interval: 30, depan: 0, cooldown: 14, status: "belum", cabang: "", cari: "" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pilih = <T extends number>(raw: string | undefined, opsi: readonly T[], awal: T): T => {
  const n = Number(raw);
  return raw != null && raw !== "" && (opsi as readonly number[]).includes(n) ? (n as T) : awal;
};

/** Saringan dari URL: nilai tak dikenal kembali ke bawaan (tidak pernah dilempar ke database). `cabang` = uuid atau "kosong" (tanpa cabang). */
export function bacaFilter(sp: Record<string, string | string[] | undefined>): FilterFollowUp {
  const satu = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const tab = adalahTab(satu("tab")) ? (satu("tab") as TabId) : FILTER_AWAL.tab;
  const status = STATUS_KONTAK.some(s => s.id === satu("status")) ? (satu("status") as StatusKontak) : FILTER_AWAL.status;
  const cabangRaw = (satu("cabang") ?? "").trim();
  return {
    tab, status,
    hari: pilih(satu("hari"), PERIODE_LAMA, FILTER_AWAL.hari),
    interval: pilih(satu("interval"), INTERVAL_GROOMING, FILTER_AWAL.interval),
    depan: pilih(satu("depan"), DEPAN_PILIHAN, FILTER_AWAL.depan),
    cooldown: pilih(satu("tunggu"), MASA_TUNGGU_PILIHAN, FILTER_AWAL.cooldown),
    cabang: cabangRaw === "kosong" || UUID.test(cabangRaw) ? cabangRaw : "",
    cari: (satu("cari") ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
  };
}

/** Query string yang hanya memuat nilai yang bukan bawaan. */
export function tautanFilter(f: FilterFollowUp, ubah: Partial<FilterFollowUp> = {}): string {
  const n = { ...f, ...ubah };
  const p = new URLSearchParams();
  p.set("tab", n.tab);
  if (n.hari !== FILTER_AWAL.hari) p.set("hari", String(n.hari));
  if (n.interval !== FILTER_AWAL.interval) p.set("interval", String(n.interval));
  if (n.depan !== FILTER_AWAL.depan) p.set("depan", String(n.depan));
  if (n.cooldown !== FILTER_AWAL.cooldown) p.set("tunggu", String(n.cooldown));
  if (n.status !== FILTER_AWAL.status) p.set("status", n.status);
  if (n.cabang) p.set("cabang", n.cabang);
  if (n.cari) p.set("cari", n.cari);
  return `${HALAMAN_FOLLOWUP}?${p.toString()}`;
}

// ───────────── bentuk hasil fungsi database ─────────────
export type DihubungiInfo = { at: string; hasil: HasilKontak; catatan: string | null; oleh: string | null; sudah: boolean; hari_lalu: number };
export type ItemFollowUp = { jenis: string; tanggal: string; catatan: string | null; hewan: string | null };
export type BarisFollowUp = {
  customer_id: string; pet_id: string | null; nama: string; hp: string | null; wa: string | null;
  hewan: string[]; hewan_total: number; cabang_id: string | null; cabang: string | null;
  terakhir: string | null; jenis_terakhir: string | null; total_belanja: number; kunjungan: number | null; hari: number | null;
  sumber: string | null; jadwal: string | null; groomer: string | null; item: ItemFollowUp[] | null; dihubungi: DihubungiInfo | null;
};
export type HasilDaftar = {
  tab: TabId; hari_ini: string; periode: number; interval: number; depan: number; cooldown: number; status: StatusKontak;
  total: number; ditampilkan: number; belum: number; sudah: number;
  bucket: { "60": number; "90": number; "180": number };
  cabang: { id: string | null; nama: string | null; jumlah: number }[];
  tanpa_nomor: number;
  dikecualikan: { kunjungan_belum_selesai: number; hewan_tiada: number; disembunyikan: number };
  riwayat_belanja_mulai: string | null;
  baris: BarisFollowUp[];
};

const adaAngka = (v: unknown) => typeof v === "number" && Number.isFinite(v);
/** null bila bentuknya tidak dikenal (pemanggil menampilkan galat, tidak menebak). */
export function bacaHasilDaftar(data: unknown): HasilDaftar | null {
  const d = data as Partial<HasilDaftar> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.baris) || !adaAngka(d.total) || !adaAngka(d.belum) || !adaAngka(d.sudah) || typeof d.hari_ini !== "string") return null;
  if (!d.bucket || !d.dikecualikan || !Array.isArray(d.cabang) || !adaAngka(d.tanpa_nomor)) return null;
  for (const r of d.baris) {
    if (!r || typeof r.customer_id !== "string" || typeof r.nama !== "string" || !Array.isArray(r.hewan)) return null;
  }
  return d as HasilDaftar;
}

// ───────────── pengelompokan ─────────────
/** Baris yang pemiliknya sama jadi satu kartu (pemilik dengan dua hewan yang jatuh tempo muncul sekali). */
export type KartuPemilik = { customer_id: string; baris: BarisFollowUp[]; nama: string; hp: string | null; wa: string | null; cabang: string | null };
export function kelompokPerPemilik(baris: BarisFollowUp[]): KartuPemilik[] {
  const peta = new Map<string, KartuPemilik>();
  for (const b of baris) {
    const ada = peta.get(b.customer_id);
    if (ada) ada.baris.push(b);
    else peta.set(b.customer_id, { customer_id: b.customer_id, baris: [b], nama: b.nama, hp: b.hp, wa: b.wa, cabang: b.cabang });
  }
  return [...peta.values()];
}

export type KelompokCabang = { id: string | null; nama: string; baris: BarisFollowUp[] };
/** Kelompok per cabang mengikuti urutan baris dari database (nama cabang, tanpa cabang paling akhir). */
export function kelompokPerCabang(baris: BarisFollowUp[]): KelompokCabang[] {
  const peta = new Map<string, KelompokCabang>();
  for (const b of baris) {
    const kunci = b.cabang_id ?? "kosong";
    const ada = peta.get(kunci);
    if (ada) ada.baris.push(b);
    else peta.set(kunci, { id: b.cabang_id, nama: b.cabang ?? LABEL_TANPA_CABANG, baris: [b] });
  }
  return [...peta.values()].sort((a, b) => (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0));
}

// ───────────── teks tampilan ─────────────
export const rupiah = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
export function teksHariLalu(hari: number | null | undefined): string {
  if (hari == null) return "-";
  if (hari === 0) return "hari ini";
  return `${hari.toLocaleString("id-ID")} hari lalu`;
}
export function teksTerlewat(hari: number | null | undefined): string {
  if (hari == null) return "-";
  if (hari > 0) return `terlewat ${hari} hari`;
  if (hari === 0) return "hari ini";
  return `H${hari}`;
}
export function ringkasHewan(b: Pick<BarisFollowUp, "hewan" | "hewan_total">): string {
  if (b.hewan.length === 0) return "Hewan tidak tercatat";
  const lebih = b.hewan_total - b.hewan.length;
  return b.hewan.join(", ") + (lebih > 0 ? ` +${lebih}` : "");
}
export function tanggalPendek(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "-";
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][m - 1]} ${y}`;
}
/** Tanggal WIB (YYYY-MM-DD) dari cap waktu UTC database. */
export function tanggalWib(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Validasi isian "Sudah dihubungi": pesan galat berbahasa Indonesia, atau null bila sah. */
export function periksaIsianKontak(hasil: string, catatan: string): string | null {
  if (!(HASIL_KONTAK as readonly string[]).includes(hasil)) return "Pilih hasil menghubungi.";
  if (catatan.trim().length > BATAS_CATATAN) return `Catatan maksimal ${BATAS_CATATAN} huruf.`;
  return null;
}

/** Kunci anti-dobel untuk satu pembukaan dialog (dibuat sekali, dipakai ulang bila tombol ditekan dua kali). */
export function kunciPermintaan(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${h(8)}-${h(4)}-4${h(3)}-8${h(3)}-${h(12)}`;
}

/** Nama kolom Excel (urutan tetap); nilai lewat amankanSel di route unduh. */
export const KOLOM_EXCEL = ["Cabang", "Nama pemilik", "Hewan", "No. HP", "Terakhir datang", "Jenis", "Hari", "Total belanja (Rp)", "Jumlah kunjungan", "Keterangan", "Status hubungi", "Hasil", "Catatan", "Dihubungi oleh"] as const;
