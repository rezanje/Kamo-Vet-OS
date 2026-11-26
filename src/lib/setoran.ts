// Rekap Setoran — bentuk data, pembacaan hasil RPC, dan rumus tampilan yang murni (dites di __tests__/setoran.test.ts).
//
// Aturan privasi (Andri, 26 Nov 2026): staf toko boleh melihat KEWAJIBAN setoran dan sisa yang harus disetor, tetapi TIDAK boleh
// melihat kelebihan (lebih), selisih, jenis (kurang/lebih), kasbon, jurnal, atau catatan penyetuju. Yang menentukan siapa melihat apa
// adalah fungsi basis data (setoran_detail / setoran_daftar / setoran_rekap membentuk hasil menurut peran); pembaca di bawah hanya
// MENOLAK bentuk yang tidak dikenal dan tidak pernah menambahkan bidang keuangan sendiri.

export const STATUS_SETORAN = ["Draft", "Diajukan", "Disetujui", "Ditolak", "Void"] as const;
export type StatusSetoran = (typeof STATUS_SETORAN)[number];

/** Peran yang menyetujui (sama dengan basis data: setoran_penyetuju()). ADMIN_UMUM dibandingkan sebagai teks. */
export const PERAN_PENYETUJU = ["OWNER", "FINANCE", "ADMIN", "ADMIN_UMUM"] as const;
export const PERAN_VOID = ["OWNER", "FINANCE"] as const;
export const isPenyetuju = (role: string | null | undefined): boolean => !!role && (PERAN_PENYETUJU as readonly string[]).includes(role);
export const bolehVoid = (role: string | null | undefined): boolean => !!role && (PERAN_VOID as readonly string[]).includes(role);

/** Dua pintu masuk: back office (penyetuju & staf ber-modul) dan layar kasir. Dipakai untuk tautan dan validasi alamat kembali. */
export const BASIS_SETORAN = ["/kas-bank/setoran", "/kasir/setoran"] as const;
export type BasisSetoran = (typeof BASIS_SETORAN)[number];
export function basisAman(v: unknown): BasisSetoran {
  return (BASIS_SETORAN as readonly string[]).includes(String(v)) ? (v as BasisSetoran) : "/kas-bank/setoran";
}

export type Lampiran = { path: string; nama: string; mime?: string | null; ukuran?: number | null };
export type HariRincian = { tanggal: string; total: number };
export type BarisPengeluaran = { id: string; tanggal: string; kategori: string; deskripsi: string | null; jumlah: number; lampiran: Lampiran[]; dimasukkan_oleh: string; expense_id: string | null };
export type BarisTransfer = {
  id: string; tanggal: string; jumlah: number; metode: "Transfer" | "Serah tunai"; rekening: string; lampiran: Lampiran[];
  status: "Menunggu" | "Dikonfirmasi" | "Ditolak"; dicatat_oleh: string; catatan: string | null; alasan_tolak?: string | null;
};
export type ShiftSetoran = { shift_id: string; jenis: string; kasir: string; dibuka: string; ditutup: string; pengeluaran_tunai_shift: number };
export type PengeluaranShift = { shift_id: string; kategori: string; deskripsi: string | null; jumlah: number };
export type RiwayatSetoran = { jenis: string; dari: string | null; ke: string | null; at: string; oleh: string; catatan?: string | null };
export type KasbonSetoran = { employee_id: string; nama: string; jumlah: number; advance_id: string; mode: string; status: string | null };
/** Bagian keuangan: HANYA ada untuk penyetuju. Staf tidak pernah menerima kunci `keuangan`. */
export type KeuanganSetoran = {
  diharapkan: number; bersih_shift: number; pengeluaran_setoran: number; transfer_dikonfirmasi: number; transfer_menunggu: number; selisih_sementara: number;
  selisih: number | null; jenis: "Pas" | "Kurang" | "Lebih" | null; penjelasan_lebih: string | null; penyelesaian: string | null; journal_id: string | null;
  pembalik_journal_id: string | null; catatan_keuangan: string | null; penanggung_otomatis: { employee_id: string; nama: string }[]; kasbon: KasbonSetoran[];
  rincian_shift: Record<string, unknown>[];
};
export type DetailSetoran = {
  id: string; no_setoran: string; branch_id: string; cabang: string; periode_mulai: string; periode_selesai: string; jadwal: string; batas_jam: string;
  status: StatusSetoran; revision: number; penyetuju: boolean; catatan: string | null; kewajiban: number; pengeluaran: number; transfer: number; sisa: number; persen: number;
  harian: HariRincian[]; shift_baru: number; dibuat_oleh: string; diajukan_oleh: string | null; diajukan_at: string | null; alasan_tolak: string | null;
  shift: ShiftSetoran[]; pengeluaran_shift: PengeluaranShift[]; pengeluaran_baris: BarisPengeluaran[]; transfer_baris: BarisTransfer[]; riwayat: RiwayatSetoran[];
  badge: string; status_periode: string; terlambat: boolean; keuangan?: KeuanganSetoran;
};
export type BarisDaftar = {
  id: string; no_setoran: string; branch_id: string; cabang: string; periode_mulai: string; periode_selesai: string; jadwal: string; batas_jam: string; status: StatusSetoran;
  kewajiban: number; pengeluaran: number; transfer: number; sisa: number; transfer_menunggu: number; umur_hari: number | null; badge: string; status_periode: string;
  terlambat: boolean; dibuat_oleh: string; alasan_tolak?: string | null; diharapkan?: number; selisih_sementara?: number; selisih?: number | null; jenis?: string | null; penyelesaian?: string | null;
};
export type RekapCabang = { branch_id: string; cabang: string; jumlah: number; menunggu: number; terlambat: number; kewajiban: number; pengeluaran: number; diharapkan: number; disetor: number; kurang: number; lebih: number };
export type RekapSetoran = {
  cabang: RekapCabang[]; total: Omit<RekapCabang, "branch_id" | "cabang">;
  umur_menunggu: { hari_0_1: number; hari_2_3: number; hari_4_7: number; hari_8_plus: number }; menunggu_persetujuan: number; terlambat: number;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, nama: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`Data setoran tidak lengkap (${nama}). Muat ulang halaman.`);
  return n;
};
const teks = (v: unknown, nama: string): string => {
  if (typeof v !== "string") throw new Error(`Data setoran tidak lengkap (${nama}). Muat ulang halaman.`);
  return v;
};
const teksNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown, nama: string): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`Data setoran tidak lengkap (${nama}). Muat ulang halaman.`);
  return v;
};

function lampiran(v: unknown): Lampiran[] {
  return (Array.isArray(v) ? v : []).filter(isObj).map((x) => ({ path: String(x.path ?? ""), nama: String(x.nama ?? "lampiran"), mime: teksNull(x.mime), ukuran: typeof x.ukuran === "number" ? x.ukuran : null }))
    .filter((x) => x.path && !x.path.includes("..") && !x.path.startsWith("/"));
}

/** Bidang keuangan yang TIDAK boleh muncul pada pembacaan untuk staf. Dipakai tes dan pembaca. */
export const BIDANG_KEUANGAN = ["keuangan", "selisih", "selisih_sementara", "jenis", "diharapkan", "penjelasan_lebih", "kasbon", "rincian_shift", "penyelesaian", "journal_id"] as const;

export function bacaDetail(raw: unknown): DetailSetoran {
  if (!isObj(raw)) throw new Error("Data setoran tidak dapat dibaca. Muat ulang halaman.");
  const status = teks(raw.status, "status");
  if (!(STATUS_SETORAN as readonly string[]).includes(status)) throw new Error("Status setoran tidak dikenal.");
  const penyetuju = raw.penyetuju === true;
  const out: DetailSetoran = {
    id: teks(raw.id, "id"), no_setoran: teks(raw.no_setoran, "nomor"), branch_id: teks(raw.branch_id, "cabang"), cabang: teks(raw.cabang, "nama cabang"),
    periode_mulai: teks(raw.periode_mulai, "periode"), periode_selesai: teks(raw.periode_selesai, "periode"), jadwal: teks(raw.jadwal, "jadwal"), batas_jam: teks(raw.batas_jam, "batas jam"),
    status: status as StatusSetoran, revision: num(raw.revision, "revisi"), penyetuju, catatan: teksNull(raw.catatan),
    kewajiban: num(raw.kewajiban, "kewajiban"), pengeluaran: num(raw.pengeluaran, "pengeluaran"), transfer: num(raw.transfer, "transfer"),
    sisa: Math.max(0, num(raw.sisa, "sisa")), persen: Math.min(100, Math.max(0, num(raw.persen, "persen"))),
    harian: arr(raw.harian, "harian").filter(isObj).map((h) => ({ tanggal: teks(h.tanggal, "tanggal"), total: num(h.total, "total harian") })),
    shift_baru: num(raw.shift_baru ?? 0, "shift baru"), dibuat_oleh: teks(raw.dibuat_oleh, "pembuat"), diajukan_oleh: teksNull(raw.diajukan_oleh), diajukan_at: teksNull(raw.diajukan_at),
    alasan_tolak: teksNull(raw.alasan_tolak),
    shift: arr(raw.shift, "shift").filter(isObj).map((s) => ({ shift_id: teks(s.shift_id, "shift"), jenis: String(s.jenis ?? ""), kasir: String(s.kasir ?? "Kasir"), dibuka: String(s.dibuka ?? ""), ditutup: String(s.ditutup ?? ""), pengeluaran_tunai_shift: Number(s.pengeluaran_tunai_shift) || 0 })),
    pengeluaran_shift: arr(raw.pengeluaran_shift, "pengeluaran shift").filter(isObj).map((p) => ({ shift_id: String(p.shift_id ?? ""), kategori: String(p.kategori ?? ""), deskripsi: teksNull(p.deskripsi), jumlah: Number(p.jumlah) || 0 })),
    pengeluaran_baris: arr(raw.pengeluaran_baris, "pengeluaran").filter(isObj).map((p) => ({ id: teks(p.id, "id baris"), tanggal: teks(p.tanggal, "tanggal"), kategori: teks(p.kategori, "kategori"), deskripsi: teksNull(p.deskripsi), jumlah: num(p.jumlah, "jumlah"), lampiran: lampiran(p.lampiran), dimasukkan_oleh: String(p.dimasukkan_oleh ?? ""), expense_id: teksNull(p.expense_id) })),
    transfer_baris: arr(raw.transfer_baris, "transfer").filter(isObj).map((t) => {
      const st = String(t.status);
      if (!["Menunggu", "Dikonfirmasi", "Ditolak"].includes(st)) throw new Error("Status transfer tidak dikenal.");
      return { id: teks(t.id, "id transfer"), tanggal: teks(t.tanggal, "tanggal"), jumlah: num(t.jumlah, "jumlah"), metode: (t.metode === "Transfer" ? "Transfer" : "Serah tunai") as BarisTransfer["metode"], rekening: String(t.rekening ?? ""), lampiran: lampiran(t.lampiran), status: st as BarisTransfer["status"], dicatat_oleh: String(t.dicatat_oleh ?? ""), catatan: teksNull(t.catatan), alasan_tolak: teksNull(t.alasan_tolak) };
    }),
    riwayat: arr(raw.riwayat, "riwayat").filter(isObj).map((r) => ({ jenis: String(r.jenis ?? ""), dari: teksNull(r.dari), ke: teksNull(r.ke), at: String(r.at ?? ""), oleh: String(r.oleh ?? ""), catatan: teksNull(r.catatan) })),
    badge: teks(raw.badge, "badge"), status_periode: teks(raw.status_periode, "status periode"), terlambat: raw.terlambat === true,
  };
  // Bagian keuangan dibaca HANYA bila pemanggil penyetuju; untuk staf diabaikan sekalipun ada (jaring pengaman kedua di atas basis data).
  if (penyetuju && isObj(raw.keuangan)) {
    const k = raw.keuangan;
    out.keuangan = {
      diharapkan: num(k.diharapkan, "diharapkan"), bersih_shift: num(k.bersih_shift, "bersih shift"), pengeluaran_setoran: num(k.pengeluaran_setoran, "pengeluaran"),
      transfer_dikonfirmasi: num(k.transfer_dikonfirmasi, "transfer dikonfirmasi"), transfer_menunggu: num(k.transfer_menunggu, "transfer menunggu"), selisih_sementara: num(k.selisih_sementara, "selisih sementara"),
      selisih: k.selisih === null || k.selisih === undefined ? null : num(k.selisih, "selisih"), jenis: k.jenis === "Pas" || k.jenis === "Kurang" || k.jenis === "Lebih" ? k.jenis : null,
      penjelasan_lebih: teksNull(k.penjelasan_lebih), penyelesaian: teksNull(k.penyelesaian), journal_id: teksNull(k.journal_id), pembalik_journal_id: teksNull(k.pembalik_journal_id), catatan_keuangan: teksNull(k.catatan_keuangan),
      penanggung_otomatis: arr(k.penanggung_otomatis ?? [], "penanggung").filter(isObj).map((e) => ({ employee_id: String(e.employee_id), nama: String(e.nama) })),
      kasbon: arr(k.kasbon ?? [], "kasbon").filter(isObj).map((b) => ({ employee_id: String(b.employee_id), nama: String(b.nama), jumlah: num(b.jumlah, "kasbon"), advance_id: String(b.advance_id), mode: String(b.mode), status: teksNull(b.status) })),
      rincian_shift: arr(k.rincian_shift ?? [], "rincian shift").filter(isObj),
    };
  }
  return out;
}

export function bacaDaftar(raw: unknown): { penyetuju: boolean; baris: BarisDaftar[] } {
  if (!isObj(raw)) throw new Error("Daftar setoran tidak dapat dibaca. Muat ulang halaman.");
  const penyetuju = raw.penyetuju === true;
  const baris = arr(raw.baris, "baris").filter(isObj).map((b): BarisDaftar => {
    const status = teks(b.status, "status");
    if (!(STATUS_SETORAN as readonly string[]).includes(status)) throw new Error("Status setoran tidak dikenal.");
    const row: BarisDaftar = {
      id: teks(b.id, "id"), no_setoran: teks(b.no_setoran, "nomor"), branch_id: teks(b.branch_id, "cabang"), cabang: teks(b.cabang, "nama cabang"), periode_mulai: teks(b.periode_mulai, "periode"),
      periode_selesai: teks(b.periode_selesai, "periode"), jadwal: teks(b.jadwal, "jadwal"), batas_jam: teks(b.batas_jam, "batas"), status: status as StatusSetoran,
      kewajiban: num(b.kewajiban, "kewajiban"), pengeluaran: num(b.pengeluaran, "pengeluaran"), transfer: num(b.transfer, "transfer"), sisa: Math.max(0, num(b.sisa, "sisa")),
      transfer_menunggu: Number(b.transfer_menunggu) || 0, umur_hari: typeof b.umur_hari === "number" ? b.umur_hari : null, badge: teks(b.badge, "badge"), status_periode: teks(b.status_periode, "status periode"),
      terlambat: b.terlambat === true, dibuat_oleh: String(b.dibuat_oleh ?? ""), alasan_tolak: teksNull(b.alasan_tolak),
    };
    if (penyetuju && b.diharapkan !== undefined) {
      row.diharapkan = num(b.diharapkan, "diharapkan"); row.selisih_sementara = num(b.selisih_sementara ?? 0, "selisih sementara");
      row.selisih = b.selisih === null || b.selisih === undefined ? null : num(b.selisih, "selisih"); row.jenis = teksNull(b.jenis); row.penyelesaian = teksNull(b.penyelesaian);
    }
    return row;
  });
  return { penyetuju, baris };
}

export function bacaRekap(raw: unknown): RekapSetoran {
  if (!isObj(raw) || !isObj(raw.total) || !isObj(raw.umur_menunggu)) throw new Error("Rekap setoran tidak dapat dibaca. Muat ulang halaman.");
  const t = raw.total, u = raw.umur_menunggu;
  const sisip = (o: Record<string, unknown>) => ({ jumlah: num(o.jumlah, "jumlah"), menunggu: num(o.menunggu, "menunggu"), terlambat: num(o.terlambat, "terlambat"), kewajiban: num(o.kewajiban, "kewajiban"), pengeluaran: num(o.pengeluaran, "pengeluaran"), diharapkan: num(o.diharapkan, "diharapkan"), disetor: num(o.disetor, "disetor"), kurang: num(o.kurang, "kurang"), lebih: num(o.lebih, "lebih") });
  return {
    cabang: arr(raw.cabang, "cabang").filter(isObj).map((c) => ({ branch_id: teks(c.branch_id, "cabang"), cabang: teks(c.cabang, "nama cabang"), ...sisip(c) })),
    total: sisip(t), umur_menunggu: { hari_0_1: num(u.hari_0_1, "umur"), hari_2_3: num(u.hari_2_3, "umur"), hari_4_7: num(u.hari_4_7, "umur"), hari_8_plus: num(u.hari_8_plus, "umur") },
    menunggu_persetujuan: num(raw.menunggu_persetujuan, "menunggu"), terlambat: num(raw.terlambat, "terlambat"),
  };
}

// ── Tampilan ────────────────────────────────────────────────────────────────────────────────────
export const rp = (n: number): string => (n < 0 ? "-" : "") + "Rp" + Math.abs(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const parts = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return { y, m, d, hari: HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] }; };
export const namaHari = (iso: string): string => parts(iso).hari;
export const tanggalPanjang = (iso: string): string => { const p = parts(iso); return `${p.hari}, ${p.d} ${BULAN[p.m - 1]} ${p.y}`; };
export const tanggalPendek = (iso: string): string => { const p = parts(iso); return `${p.d} ${BULAN[p.m - 1].slice(0, 3)} ${p.y}`; };
/** "Jumat – Minggu" untuk periode lebih dari satu hari; satu hari = nama harinya saja. */
export const labelPeriode = (mulai: string, selesai: string): string => (mulai === selesai ? namaHari(mulai) : `${namaHari(mulai)} – ${namaHari(selesai)}`);
export const labelBatas = (jam: string): string => `Sebelum pukul ${jam.replace(":", ".")}`;

export function warnaBadge(badge: string): { bg: string; fg: string } {
  if (badge === "Lunas") return { bg: "#dcfce7", fg: "#166534" };
  if (badge === "Terlambat") return { bg: "#fee2e2", fg: "#991b1b" };
  if (badge === "Menunggu persetujuan" || badge === "Lunas (belum ditutup)") return { bg: "#dbeafe", fg: "#1e40af" };
  if (badge === "Dibatalkan") return { bg: "#e5e7eb", fg: "#374151" };
  return { bg: "#ffedd5", fg: "#9a3412" };
}

export const bisaDiedit = (status: StatusSetoran): boolean => status === "Draft" || status === "Ditolak";

/** Pesan galat basis data tanpa kode teknis di depannya ("SETORAN_X: pesan"). Pesan lain dikembalikan apa adanya. */
export function pesanSetoran(message: string): string {
  const m = /^(?:ERROR:\s*)?SETORAN_[A-Z_]+:\s*([\s\S]*)$/.exec(message.trim());
  if (m) return m[1];
  if (/ADMIN_ONLINE_FUNCTION_DENIED/.test(message)) return "Fitur ini tidak tersedia untuk akun Admin Online.";
  return message;
}

/** Baris Excel rekap (khusus penyetuju): satu baris per setoran + total. Tanpa data pribadi selain nama pembuat. */
export function barisExcel(daftar: BarisDaftar[]): { judul: string[]; baris: (string | number)[][] } {
  const judul = ["No setoran", "Cabang", "Periode mulai", "Periode selesai", "Jadwal", "Status", "Kewajiban", "Pengeluaran", "Diharapkan", "Ditransfer", "Selisih", "Jenis", "Penyelesaian", "Umur menunggu (hari)"];
  const baris = daftar.map((b) => [b.no_setoran, b.cabang, b.periode_mulai, b.periode_selesai, b.jadwal, b.status, b.kewajiban, b.pengeluaran, b.diharapkan ?? b.kewajiban - b.pengeluaran, b.transfer,
    b.selisih ?? b.selisih_sementara ?? 0, b.jenis ?? "", b.penyelesaian ?? "", b.umur_hari ?? ""]);
  return { judul, baris };
}

/** Kunci permintaan per tampilan form: dipakai ulang bila tombol ditekan dua kali, baru lagi sesudah halaman dimuat ulang. */
export const kunciBaru = (): string => globalThis.crypto.randomUUID();

/** Tanggal (YYYY-MM-DD) → Date lokal WIB sederhana untuk pemilih tanggal bawaan. */
export function geserTanggal(iso: string, hari: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + hari); return d.toISOString().slice(0, 10);
}
/** Bawaan form buat periode: Jumat-Minggu terakhir yang sudah lewat, jadwal Senin berikutnya (atau hari ini bila Senin). Murni dan dites. */
export function periodeBawaan(hariIni: string): { mulai: string; selesai: string; jadwal: string } {
  const hari = new Date(`${hariIni}T00:00:00Z`).getUTCDay(); // 0=Minggu
  const sejakMinggu = hari === 0 ? 7 : hari;               // hari sejak Minggu terakhir yang sudah lewat (Minggu hari ini belum selesai)
  const selesai = geserTanggal(hariIni, -sejakMinggu);      // Minggu lalu
  return { mulai: geserTanggal(selesai, -2), selesai, jadwal: geserTanggal(selesai, 1) };
}
