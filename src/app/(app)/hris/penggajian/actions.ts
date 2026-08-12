"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { AKUN_PIUTANG_KARYAWAN } from "@/lib/kasbon";
import { jurnalPenggajian } from "@/lib/payroll";
import { akhirBulan, kumpulkanDataGaji } from "@/lib/payroll-data";
import { cekPeriode, jurnalTersimpan } from "@/lib/jurnal-guard";

const BASE = "/hris/penggajian";
const BOLEH = ["OWNER", "ADMIN"];

const kembali = (periode: string) => `${BASE}?periode=${periode}`;

function periodeDari(formData: FormData): string {
  const p = String(formData.get("periode") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(p)) redirect(`${BASE}?error=${encodeURIComponent("Periode tidak valid")}`);
  return p;
}

// Hitung ulang seluruh karyawan untuk satu periode. Koreksi manual yang sudah
// diketik dipertahankan supaya tidak hilang saat tombol Hitung ditekan lagi.
export async function hitungPenggajian(formData: FormData) {
  const periode = periodeDari(formData);
  const gagal = (msg: string): never => redirect(`${kembali(periode)}&error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(kembali(periode), "penggajian", BOLEH);

  const { data: lama } = await supabase
    .from("payrolls").select("employee_id, penyesuaian, status").eq("periode", periode);
  const rows = (lama ?? []) as { employee_id: string; penyesuaian: number; status: string }[];
  if (rows.some((r) => r.status === "final")) gagal("Penggajian periode ini sudah disahkan — tidak bisa dihitung ulang");

  const penyesuaian = new Map(rows.map((r) => [r.employee_id, Number(r.penyesuaian)]));
  const baris = await kumpulkanDataGaji(supabase, periode, penyesuaian);
  if (baris.length === 0) gagal("Tidak ada karyawan aktif");

  const { error } = await supabase.from("payrolls").upsert(
    baris.map((b) => ({
      periode,
      employee_id: b.employeeId,
      gaji_pokok: b.rincian.gajiPokok,
      tunjangan: b.rincian.tunjangan,
      potongan: b.rincian.potonganTetap + b.rincian.potonganTelat + b.rincian.potonganBolos + b.rincian.cicilanKasbon,
      total: b.rincian.total,
      hari_kerja: b.rincian.hariKerja,
      hari_hadir: b.rincian.hariHadir,
      hari_bolos: b.rincian.hariBolos,
      menit_telat: b.rincian.menitTelat,
      jam_lembur: b.rincian.jamLembur,
      upah_lembur: b.rincian.upahLembur,
      potongan_telat: b.rincian.potonganTelat,
      potongan_bolos: b.rincian.potonganBolos,
      cicilan_kasbon: b.rincian.cicilanKasbon,
      reimburse: b.rincian.reimburse,
      komisi: b.rincian.komisi,
      penyesuaian: b.rincian.penyesuaian,
      status: "draft",
    })),
    { onConflict: "periode,employee_id" },
  );
  if (error) gagal(error.message);

  redirect(`${kembali(periode)}&success=hitung`);
}

// Koreksi manual per karyawan. Hasil hitungan otomatis tidak ditimpa — koreksi
// disimpan terpisah lalu ikut dihitung ulang.
export async function simpanKoreksi(formData: FormData) {
  const periode = periodeDari(formData);
  const gagal = (msg: string): never => redirect(`${kembali(periode)}&error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(kembali(periode), "penggajian", BOLEH);

  const { data: lama } = await supabase
    .from("payrolls").select("employee_id, status").eq("periode", periode);
  const rows = (lama ?? []) as { employee_id: string; status: string }[];
  if (rows.length === 0) gagal("Hitung dulu penggajian periode ini");
  if (rows.some((r) => r.status === "final")) gagal("Penggajian periode ini sudah disahkan");

  const penyesuaian = new Map<string, number>();
  for (const r of rows) {
    const v = Number(formData.get(`adj_${r.employee_id}`));
    penyesuaian.set(r.employee_id, Number.isFinite(v) ? v : 0);
  }

  const baris = await kumpulkanDataGaji(supabase, periode, penyesuaian);
  for (const b of baris) {
    const catatan = String(formData.get(`note_${b.employeeId}`) ?? "").trim() || null;
    await supabase.from("payrolls").update({
      penyesuaian: b.rincian.penyesuaian,
      total: b.rincian.total,
      catatan,
    }).eq("periode", periode).eq("employee_id", b.employeeId);
  }

  redirect(`${kembali(periode)}&success=koreksi`);
}

// Sahkan: kunci slip, catat cicilan kasbon, tandai reimburse terbayar, lalu jurnal.
export async function sahkanPenggajian(formData: FormData) {
  const periode = periodeDari(formData);
  const gagal = (msg: string): never => redirect(`${kembali(periode)}&error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(kembali(periode), "penggajian", BOLEH);

  const tanggal = akhirBulan(periode);
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: slipData } = await supabase
    .from("payrolls").select("employee_id, total, cicilan_kasbon, reimburse, status").eq("periode", periode);
  const slip = (slipData ?? []) as { employee_id: string; total: number; cicilan_kasbon: number; reimburse: number; status: string }[];
  if (slip.length === 0) gagal("Belum ada perhitungan untuk periode ini");
  if (slip.some((s) => s.status === "final")) gagal("Penggajian periode ini sudah disahkan");

  // Sumber kasbon & reimburse dibaca ulang supaya id-nya pasti yang berlaku sekarang.
  const baris = await kumpulkanDataGaji(supabase, periode, new Map(slip.map((s) => [s.employee_id, 0])));
  const perKaryawan = new Map(baris.map((b) => [b.employeeId, b]));

  const totalNetto = slip.reduce((a, s) => a + Number(s.total), 0);
  const totalCicilan = slip.reduce((a, s) => a + Number(s.cicilan_kasbon), 0);
  if (totalNetto <= 0 && totalCicilan <= 0) gagal("Tidak ada nilai gaji untuk dibukukan");

  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const kasCode = await kodeAkunBayar(supabase, "Transfer", null, accountId);

  // 1) Cicilan kasbon: satu baris per kasbon per periode (unik), lalu tandai lunas.
  //    Satu karyawan bisa punya lebih dari satu utang berjalan — kasbon yang ia
  //    ajukan sendiri, plus utang selisih kas dari tutup shift. Angka yang dipakai
  //    adalah cicilan yang BENAR-BENAR tertutup gaji periode ini; kalau gajinya
  //    tidak cukup, sisanya tetap jadi utang dan tidak boleh ditandai lunas.
  for (const s of slip) {
    if (Number(s.cicilan_kasbon) <= 0) continue;
    const b = perKaryawan.get(s.employee_id);
    for (const c of b?.cicilanKasbon ?? []) {
      if (!c.id || c.jumlah <= 0) continue;

      await supabase.from("cash_advance_installments")
        .upsert({ advance_id: c.id, periode, jumlah: c.jumlah }, { onConflict: "advance_id,periode" });

      const { data: adv } = await supabase
        .from("cash_advances").select("jumlah, cash_advance_installments(jumlah)").eq("id", c.id).maybeSingle();
      if (adv) {
        const dibayar = ((adv.cash_advance_installments ?? []) as { jumlah: number }[])
          .reduce((a, i) => a + Number(i.jumlah), 0);
        if (dibayar >= Number(adv.jumlah)) {
          await supabase.from("cash_advances").update({ status: "Lunas" }).eq("id", c.id);
        }
      }
    }
  }

  // 2) Reimburse yang ikut dibayar periode ini.
  for (const s of slip) {
    if (Number(s.reimburse) <= 0) continue;
    const ids = perKaryawan.get(s.employee_id)?.reimburseIds ?? [];
    if (ids.length === 0) continue;
    await supabase.from("reimbursements")
      .update({ status: "Dibayar", paid_periode: periode }).in("id", ids);
  }

  // 3) Jurnal satu periode.
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Penggajian ${periode}`,
    source: "payroll",
    sourceRef: periode,
    branchId: null,
    lines: jurnalPenggajian(kasCode, AKUN_PIUTANG_KARYAWAN, totalNetto, totalCicilan),
  });

  if (!(await jurnalTersimpan(supabase, "payroll", periode))) {
    gagal("Jurnal penggajian gagal tersimpan — slip belum disahkan, coba lagi");
  }

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("payrolls")
    .update({ status: "final", disahkan_at: new Date().toISOString(), disahkan_by: user?.id ?? null })
    .eq("periode", periode);

  redirect(`${kembali(periode)}&success=sah`);
}
