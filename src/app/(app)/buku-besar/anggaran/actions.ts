"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { bolehTransfer } from "@/lib/anggaran";
import { serapanPeriode } from "@/lib/anggaran-data";

const BASE = "/buku-besar/anggaran";
const TRANSFER = "/buku-besar/transfer-anggaran";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];

const kembali = (base: string, periode: string) => `${base}?periode=${periode}`;
const periodeValid = (p: string) => /^\d{4}-\d{2}$/.test(p);

export async function simpanAnggaran(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  if (!periodeValid(periode)) redirect(`${BASE}?error=${encodeURIComponent("Periode tidak valid")}`);
  const gagal = (msg: string): never => redirect(`${kembali(BASE, periode)}&error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(kembali(BASE, periode), "anggaran", BOLEH);

  const coaCode = String(formData.get("coa_code") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const jumlah = Number(formData.get("jumlah")) || 0;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!coaCode) gagal("Pilih akun beban dulu");
  if (jumlah < 0) gagal("Anggaran tidak boleh negatif");

  const { data: { user } } = await supabase.auth.getUser();
  // Index uniknya (periode, akun, cabang) — upsert supaya mengubah angka anggaran
  // yang sudah ada tidak perlu dihapus dulu.
  const { error } = await supabase.from("budgets").upsert(
    { periode, coa_code: coaCode, branch_id: branchId, jumlah, catatan, created_by: user?.id ?? null },
    { onConflict: "periode,coa_code,branch_id" },
  );
  if (error) gagal(error.message);

  redirect(`${kembali(BASE, periode)}&success=${encodeURIComponent("Anggaran tersimpan.")}`);
}

export async function hapusAnggaran(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  const supabase = await assertRole(kembali(BASE, periode), "anggaran", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect(`${kembali(BASE, periode)}&error=${encodeURIComponent("Anggaran tidak valid")}`);

  const { error } = await supabase.from("budgets").delete().eq("id", id);
  redirect(error
    ? `${kembali(BASE, periode)}&error=${encodeURIComponent(error.message)}`
    : `${kembali(BASE, periode)}&success=${encodeURIComponent("Anggaran dihapus.")}`);
}

/** Salin seluruh anggaran bulan sebelumnya — menyusun ulang dari nol tiap bulan itu siksaan. */
export async function salinAnggaranBulanLalu(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  if (!periodeValid(periode)) redirect(`${BASE}?error=${encodeURIComponent("Periode tidak valid")}`);
  const gagal = (msg: string): never => redirect(`${kembali(BASE, periode)}&error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(kembali(BASE, periode), "anggaran", BOLEH);

  const [thn, bln] = periode.split("-").map(Number);
  const lalu = new Date(thn, bln - 2, 1);
  const periodeLalu = `${lalu.getFullYear()}-${String(lalu.getMonth() + 1).padStart(2, "0")}`;

  const { data: sumber } = await supabase
    .from("budgets").select("coa_code, branch_id, jumlah, catatan").eq("periode", periodeLalu);
  const baris = (sumber ?? []) as { coa_code: string; branch_id: string | null; jumlah: number; catatan: string | null }[];
  if (baris.length === 0) gagal(`Bulan ${periodeLalu} belum punya anggaran untuk disalin`);

  const { data: { user } } = await supabase.auth.getUser();
  // Baris yang sudah ada di periode ini ikut tertimpa — menyalin dua kali tidak
  // menggandakan anggaran.
  const { error } = await supabase.from("budgets").upsert(
    baris.map((b) => ({ ...b, periode, created_by: user?.id ?? null })),
    { onConflict: "periode,coa_code,branch_id" },
  );
  if (error) gagal(error.message);

  redirect(`${kembali(BASE, periode)}&success=${encodeURIComponent(`${baris.length} baris anggaran disalin dari ${periodeLalu}.`)}`);
}

export async function geserAnggaran(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  if (!periodeValid(periode)) redirect(`${TRANSFER}?error=${encodeURIComponent("Periode tidak valid")}`);
  const gagal = (msg: string): never => redirect(`${kembali(TRANSFER, periode)}&error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(kembali(TRANSFER, periode), "transfer anggaran", BOLEH);

  const dari = String(formData.get("dari_coa") ?? "").trim();
  const ke = String(formData.get("ke_coa") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const jumlah = Number(formData.get("jumlah")) || 0;
  const alasan = String(formData.get("alasan") ?? "").trim() || null;

  if (!dari || !ke) gagal("Pilih pos asal dan pos tujuan");
  if (dari === ke) gagal("Pos asal dan tujuan tidak boleh sama");
  if (jumlah <= 0) gagal("Nominal pergeseran harus lebih dari 0");

  // Sisa pos asal dihitung dari angka yang sama dengan layar monitor, supaya tidak
  // ada pergeseran yang lolos gara-gara dua layar menghitung beda.
  const { ringkasan } = await serapanPeriode(supabase, periode, branchId);
  const asal = ringkasan.find((r) => r.coaCode === dari);
  const cek = bolehTransfer(asal?.anggaran ?? 0, asal?.realisasi ?? 0, jumlah);
  if (!cek.boleh) {
    gagal(cek.maksimal <= 0
      ? "Anggaran pos asal sudah habis terpakai — tidak ada yang bisa digeser"
      : `Maksimal yang bisa digeser dari pos itu Rp ${cek.maksimal.toLocaleString("id-ID")}`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("budget_transfers").insert({
    periode, dari_coa: dari, ke_coa: ke, branch_id: branchId, jumlah, alasan, created_by: user?.id ?? null,
  });
  if (error) gagal(error.message);

  redirect(`${kembali(TRANSFER, periode)}&success=${encodeURIComponent("Anggaran digeser.")}`);
}

export async function batalGeserAnggaran(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  const supabase = await assertRole(kembali(TRANSFER, periode), "transfer anggaran", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect(`${kembali(TRANSFER, periode)}&error=${encodeURIComponent("Pergeseran tidak valid")}`);

  const { error } = await supabase.from("budget_transfers").delete().eq("id", id);
  redirect(error
    ? `${kembali(TRANSFER, periode)}&error=${encodeURIComponent(error.message)}`
    : `${kembali(TRANSFER, periode)}&success=${encodeURIComponent("Pergeseran dibatalkan.")}`);
}
