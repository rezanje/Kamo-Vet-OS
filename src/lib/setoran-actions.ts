"use server";

// Aksi server Rekap Setoran. Semua penolakan DIKEMBALIKAN lewat alamat (?error=...) — galat yang dilempar disamarkan Next.js di produksi.
// Hak sebenarnya (siapa boleh apa, pemisahan tugas, periode tutup buku, privasi) ditegakkan basis data; di sini hanya merapikan isian.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseLampiran } from "@/lib/dokumen";
import { basisAman, pesanSetoran, type BasisSetoran } from "@/lib/setoran";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const teks = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
const uuid = (f: FormData, k: string): string | null => { const v = teks(f, k); return UUID.test(v) ? v : null; };
const angka = (f: FormData, k: string): number => { const v = teks(f, k).replace(/\s/g, ""); return v === "" ? NaN : Number(v); };
const rev = (f: FormData): number => { const n = Number(teks(f, "revision")); return Number.isInteger(n) && n >= 0 ? n : -1; };

function ke(basis: BasisSetoran, id: string | null, kv: { error?: string; success?: string }): never {
  const q = new URLSearchParams();
  if (kv.error) q.set("error", kv.error);
  if (kv.success) q.set("success", kv.success);
  revalidatePath(basis);
  if (id) revalidatePath(`${basis}/${id}`);
  redirect(`${basis}${id ? `/${id}` : ""}${q.toString() ? `?${q}` : ""}`);
}

type Hasil = { data: unknown; error: { message: string } | null };
async function panggil(nama: string, args: Record<string, unknown>): Promise<Hasil> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: "Sesi berakhir. Masuk lagi." } };
  const r = await supabase.rpc(nama, args);
  return { data: r.data, error: r.error ? { message: r.error.message } : null };
}

export async function buatSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis"));
  const branch = uuid(formData, "branchId"), key = uuid(formData, "request_key");
  if (!branch || !key) ke(basis, null, { error: "Pilih cabang dan muat ulang halaman bila kunci permintaan hilang." });
  const r = await panggil("setoran_buat", { p_branch: branch, p_mulai: teks(formData, "mulai"), p_selesai: teks(formData, "selesai"), p_jadwal: teks(formData, "jadwal"), p_batas_jam: teks(formData, "jam") || "12:00", p_request_key: key });
  if (r.error) ke(basis, null, { error: pesanSetoran(r.error.message) });
  const id = (r.data as { id?: string } | null)?.id;
  if (!id) ke(basis, null, { error: "Setoran belum terkonfirmasi tersimpan. Periksa daftar sebelum mengulang." });
  ke(basis, id as string, { success: "Periode setoran dibuat. Isi pengeluaran dan transfer di bawah dashboard." });
}

export async function sinkronSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id");
  if (!id) ke(basis, null, { error: "Setoran tidak dikenal." });
  const r = await panggil("setoran_sinkron", { p_id: id });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  const n = Number((r.data as { shift_baru?: number } | null)?.shift_baru ?? 0);
  ke(basis, id, { success: n > 0 ? `${n} shift tertutup ditambahkan ke setoran.` : "Tidak ada shift tertutup baru." });
}

export async function tambahPengeluaranSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key");
  const jumlah = angka(formData, "jumlah"), lampiran = parseLampiran(formData.get("lampiran"));
  if (!id || !key || rev(formData) < 0) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  if (!Number.isFinite(jumlah) || jumlah <= 0 || Number(jumlah.toFixed(2)) !== jumlah) ke(basis, id, { error: "Jumlah pengeluaran harus lebih dari 0 (maksimal 2 angka di belakang koma)." });
  if (!teks(formData, "kategori")) ke(basis, id, { error: "Pilih kategori pengeluaran." });
  if (!lampiran.length) ke(basis, id, { error: "Lampiran bukti pengeluaran wajib diisi." });
  const r = await panggil("setoran_tambah_pengeluaran", { p_id: id, p_tanggal: teks(formData, "tanggal"), p_kategori: teks(formData, "kategori"), p_jumlah: jumlah, p_deskripsi: teks(formData, "deskripsi") || null, p_lampiran: lampiran, p_revision: rev(formData), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Pengeluaran dicatat dan mengurangi sisa setoran. Jurnalnya baru dibukukan saat setoran disetujui." });
}

export async function hapusPengeluaranSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), baris = uuid(formData, "baris"), key = uuid(formData, "request_key");
  if (!id || !baris || !key || rev(formData) < 0) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_hapus_pengeluaran", { p_id: id, p_baris: baris, p_revision: rev(formData), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Pengeluaran dihapus dari setoran." });
}

export async function tambahTransferSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key"), rekening = uuid(formData, "rekening");
  const jumlah = angka(formData, "jumlah"), lampiran = parseLampiran(formData.get("lampiran")), metode = teks(formData, "metode");
  if (!id || !key || rev(formData) < 0) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  if (!rekening) ke(basis, id, { error: "Pilih rekening tujuan perusahaan." });
  if (metode !== "Transfer" && metode !== "Serah tunai") ke(basis, id, { error: "Pilih Transfer atau Serah tunai." });
  if (!Number.isFinite(jumlah) || jumlah <= 0 || Number(jumlah.toFixed(2)) !== jumlah) ke(basis, id, { error: "Jumlah harus lebih dari 0 (maksimal 2 angka di belakang koma)." });
  if (metode === "Transfer" && !lampiran.length) ke(basis, id, { error: "Foto bukti transfer wajib diisi." });
  const r = await panggil("setoran_tambah_transfer", { p_id: id, p_tanggal: teks(formData, "tanggal"), p_jumlah: jumlah, p_metode: metode, p_rekening: rekening, p_lampiran: lampiran, p_catatan: teks(formData, "catatan") || null, p_revision: rev(formData), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Setoran dicatat. Status Menunggu sampai Finance mengonfirmasi uang masuk." });
}

export async function hapusTransferSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), tr = uuid(formData, "transfer"), key = uuid(formData, "request_key");
  if (!id || !tr || !key || rev(formData) < 0) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_hapus_transfer", { p_id: id, p_transfer: tr, p_revision: rev(formData), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Catatan setoran dihapus." });
}

export async function putuskanTransferSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), tr = uuid(formData, "transfer"), key = uuid(formData, "request_key");
  const terima = teks(formData, "keputusan") === "terima";
  if (!id || !tr || !key) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_putuskan_transfer", { p_id: id, p_transfer: tr, p_terima: terima, p_catatan: teks(formData, "catatan") || null, p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: terima ? "Uang masuk dikonfirmasi." : "Setoran ditolak (tidak dihitung)." });
}

export async function ajukanSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key");
  if (!id || !key || rev(formData) < 0) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_ajukan", { p_id: id, p_revision: rev(formData), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Setoran diajukan ke Finance untuk ditutup." });
}

export async function batalkanDraftSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key");
  if (!id || !key) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_batalkan_draft", { p_id: id, p_alasan: teks(formData, "alasan"), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, null, { success: "Setoran dibuang." });
}

export async function tolakSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key");
  if (!id || !key) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_tolak", { p_id: id, p_alasan: teks(formData, "alasan"), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Setoran dikembalikan ke petugas untuk diperbaiki. Jangan menuliskan nominal selisih di alasan." });
}

/** Baris alokasi manual: employee_1/jumlah_1 .. employee_5/jumlah_5; baris kosong diabaikan. null = pakai pembagian otomatis. */
export async function bacaAlokasi(formData: FormData): Promise<{ employee_id: string; jumlah: number }[] | null | "tidak-valid"> {
  const rows: { employee_id: string; jumlah: number }[] = [];
  for (let i = 1; i <= 5; i++) {
    const emp = teks(formData, `employee_${i}`), jml = teks(formData, `jumlah_${i}`);
    if (!emp && !jml) continue;
    const n = Number(jml);
    if (!UUID.test(emp) || !Number.isFinite(n) || n <= 0 || Number(n.toFixed(2)) !== n) return "tidak-valid";
    rows.push({ employee_id: emp, jumlah: n });
  }
  return rows.length ? rows : null;
}

export async function setujuiSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key");
  if (!id || !key) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const alokasi = await bacaAlokasi(formData);
  if (alokasi === "tidak-valid") ke(basis, id, { error: "Alokasi karyawan tidak valid: pilih karyawan dan isi jumlah lebih dari 0 (maksimal 2 desimal)." });
  const r = await panggil("setoran_setujui", {
    p_id: id, p_request_key: key, p_penjelasan: teks(formData, "penjelasan") || null, p_alokasi: alokasi, p_beban_perusahaan: formData.get("beban") === "on",
    p_konfirmasi_besar: formData.get("besar") === "on", p_catatan: teks(formData, "catatan") || null,
  });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Setoran disetujui dan periode ditutup." });
}

export async function voidSetoran(formData: FormData): Promise<void> {
  const basis = basisAman(formData.get("basis")), id = uuid(formData, "id"), key = uuid(formData, "request_key");
  if (!id || !key) ke(basis, id, { error: "Muat ulang halaman lalu coba lagi." });
  const r = await panggil("setoran_void", { p_id: id, p_alasan: teks(formData, "alasan"), p_request_key: key });
  if (r.error) ke(basis, id, { error: pesanSetoran(r.error.message) });
  ke(basis, id, { success: "Setoran dibatalkan dengan jurnal pembalik." });
}
