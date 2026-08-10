"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { cekPeriode, jurnalTersimpan } from "@/lib/jurnal-guard";
import { jurnalBalik } from "@/lib/transfer-kas";
import { akunLawanTerlarang, hrefKas, jurnalKasEntry, nomorKasEntry, validasiKasEntry, type JenisKas } from "@/lib/kas-entry";
import { parseLampiran } from "@/lib/dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { postJournal } from "@/lib/posting";
import { prefixBulanan, urutanBerikutnya } from "@/lib/no-dokumen";

const BOLEH = ["OWNER", "ADMIN", "FINANCE"];

const bacaJenis = (formData: FormData): JenisKas =>
  String(formData.get("jenis") ?? "") === "Masuk" ? "Masuk" : "Keluar";

type Rekening = { id: string; nama: string; coa_code: string; is_active: boolean };

export async function simpanKasEntry(formData: FormData) {
  const jenis = bacaJenis(formData);
  const BACK = hrefKas(jenis);
  const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(BACK, "kas masuk/keluar", BOLEH);

  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "").trim();
  const lawanCode = String(formData.get("lawan_code") ?? "").trim();
  const jumlah = Number(formData.get("jumlah"));
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const salah = validasiKasEntry({ jenis, tanggal, accountId, lawanCode, jumlah, hariIni: hariIniWIB() });
  if (salah) gagal(salah);

  // Kas keluar = uang keluar tanpa faktur; tanpa bukti tidak bisa diaudit sama
  // sekali. Kas masuk buktinya opsional (setoran internal sering tanpa nota).
  const lampiran = parseLampiran(formData.get("lampiran"));
  if (jenis === "Keluar" && lampiran.length === 0) {
    gagal("Lampiran bukti wajib diisi untuk kas keluar");
  }

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Kode akun diambil dari master, bukan dari form — form cuma mengirim id.
  const { data: rekData } = await supabase
    .from("cash_accounts").select("id, nama, coa_code, is_active").eq("id", accountId);
  const rek = ((rekData ?? []) as Rekening[])[0];
  if (!rek) gagal("Rekening tidak ditemukan");
  if (!rek.is_active) gagal("Rekening yang dipilih sudah nonaktif");

  // Rekening kas/bank tidak boleh jadi akun lawan — itu transfer, bukan kas masuk/keluar.
  const { data: semuaRek } = await supabase.from("cash_accounts").select("coa_code");
  const terlarang = akunLawanTerlarang(((semuaRek ?? []) as { coa_code: string }[]).map((r) => r.coa_code));
  if (terlarang.has(lawanCode)) {
    gagal("Akun lawan tidak boleh rekening kas/bank — pakai menu Transfer Bank.");
  }

  // Nomor per bulan, dilanjutkan dari nomor tertinggi bulan itu. Awalannya sudah
  // memisahkan Masuk (KM) dari Keluar (KK), jadi tidak perlu saringan jenis lagi.
  const seq = await urutanBerikutnya(supabase, {
    table: "cash_entries", column: "no_bukti",
    prefix: prefixBulanan(jenis === "Masuk" ? "KM" : "KK", tanggal.slice(0, 7)), pad: 5,
  });
  const noBukti = nomorKasEntry(jenis, tanggal, seq - 1);

  const { data: { user } } = await supabase.auth.getUser();

  const { data: entry, error: entryErr } = await supabase.from("cash_entries").insert({
    no_bukti: noBukti, jenis, tanggal,
    account_id: accountId, lawan_code: lawanCode, jumlah,
    branch_id: branchId, keterangan, created_by: user?.id ?? null,
  }).select("id").maybeSingle();

  if (entryErr || !entry) {
    gagal(entryErr?.message.includes("cash_entries_no_bukti_key")
      ? "Nomor bukti bentrok, coba simpan sekali lagi"
      : "Gagal menyimpan, coba lagi");
  }

  if (lampiran.length > 0) {
    await supabase.from("document_attachments").insert(
      lampiran.map((l) => ({ ...l, modul: "pengeluaran", ref_id: entry!.id, uploaded_by: user?.id ?? null })),
    );
  }

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Kas ${jenis} ${rek.nama} (${noBukti})${keterangan ? ` — ${keterangan}` : ""}`,
    source: "kas-entry",
    sourceRef: noBukti,
    branchId,
    lines: jurnalKasEntry(jenis, rek.coa_code, lawanCode, jumlah),
  });

  // Uang berpindah di layar tapi tidak di pembukuan = lebih buruk daripada gagal.
  if (!(await jurnalTersimpan(supabase, "kas-entry", noBukti))) {
    await supabase.from("cash_entries").delete().eq("id", entry!.id);
    gagal("Jurnal gagal tersimpan, transaksi dibatalkan — coba lagi");
  }

  redirect(`${BACK}?success=1`);
}

export async function batalkanKasEntry(formData: FormData) {
  const jenis = bacaJenis(formData);
  const BACK = hrefKas(jenis);
  const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(BACK, "kas masuk/keluar", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Transaksi tidak valid");

  const { data: entry } = await supabase
    .from("cash_entries")
    .select("id, no_bukti, jenis, tanggal, jumlah, lawan_code, branch_id, voided_at, account_id")
    .eq("id", id).maybeSingle();
  if (!entry) gagal("Transaksi tidak ditemukan");
  if (entry.voided_at) gagal("Transaksi ini sudah dibatalkan");

  // Jurnal balik bertanggal SAMA dengan bukti asli — kalau dilempar ke hari ini,
  // laporan dua bulan sama-sama jadi salah.
  const pesanPeriode = await cekPeriode(supabase, entry.tanggal as string);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: rekData } = await supabase
    .from("cash_accounts").select("id, nama, coa_code, is_active").eq("id", entry.account_id as string);
  const rek = ((rekData ?? []) as Rekening[])[0];
  if (!rek) gagal("Rekening transaksi ini tidak ditemukan");

  // Predikat voided_at ada di UPDATE-nya sendiri supaya klik dobel tidak
  // menghasilkan dua jurnal balik.
  const { data: updated } = await supabase
    .from("cash_entries").update({ voided_at: new Date().toISOString() })
    .eq("id", id).is("voided_at", null).select("id");
  if (!updated || updated.length === 0) gagal("Transaksi ini sudah dibatalkan");

  await postJournal(supabase, {
    tanggal: entry.tanggal as string,
    deskripsi: `Pembatalan kas ${entry.jenis} ${entry.no_bukti}`,
    source: "kas-entry-void",
    sourceRef: entry.no_bukti as string,
    branchId: (entry.branch_id as string | null) ?? null,
    lines: jurnalBalik(jurnalKasEntry(
      entry.jenis as JenisKas, rek.coa_code, entry.lawan_code as string, Number(entry.jumlah),
    )),
  });

  if (!(await jurnalTersimpan(supabase, "kas-entry-void", entry.no_bukti as string))) {
    await supabase.from("cash_entries").update({ voided_at: null }).eq("id", id);
    gagal("Jurnal pembatalan gagal tersimpan, pembatalan dibatalkan — coba lagi");
  }

  redirect(`${BACK}?success=batal`);
}
