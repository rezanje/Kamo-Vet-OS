"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// ponytail: server action penggajian — upsert payrolls + auto-jurnal akuntansi.

type RowInput = {
  employee_id: string;
  gaji_pokok: number;
  tunjangan: number;
  potongan: number;
};

export async function prosesPenggajian(formData: FormData) {
  const supabase = await createClient();

  const periode = String(formData.get("periode") ?? "").trim();
  if (!periode)
    redirect(`/hris/penggajian?error=${encodeURIComponent("Periode wajib dipilih")}`);

  let rows: RowInput[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    rows = [];
  }

  if (rows.length < 1)
    redirect(`/hris/penggajian?error=${encodeURIComponent("Tidak ada karyawan untuk diproses")}`);

  // Hitung total per baris.
  const payrollRows = rows.map((r) => ({
    periode,
    employee_id: r.employee_id,
    gaji_pokok: Number(r.gaji_pokok) || 0,
    tunjangan: Number(r.tunjangan) || 0,
    potongan: Number(r.potongan) || 0,
    total: (Number(r.gaji_pokok) || 0) + (Number(r.tunjangan) || 0) - (Number(r.potongan) || 0),
  }));

  // Hapus data lama untuk periode ini dulu, lalu insert ulang (lebih prediktable dari upsert).
  // Alternatif: .upsert(payrollRows, { onConflict: "periode,employee_id" }) — kedua cara valid.
  await supabase.from("payrolls").delete().eq("periode", periode);

  const { error: insertErr } = await supabase.from("payrolls").insert(payrollRows);
  if (insertErr)
    redirect(`/hris/penggajian?error=${encodeURIComponent("Gagal menyimpan data penggajian: " + insertErr.message)}`);

  // Hitung agregat untuk jurnal.
  const grossTotal   = payrollRows.reduce((a, r) => a + r.gaji_pokok + r.tunjangan, 0);
  const potonganTotal = payrollRows.reduce((a, r) => a + r.potongan, 0);
  const netTotal      = payrollRows.reduce((a, r) => a + r.total, 0); // = grossTotal - potonganTotal

  // Post satu jurnal otomatis.
  // Dr 5201 Beban Gaji & Tunjangan = grossTotal
  // Cr 1101 Kas                    = netTotal
  // Cr 2301 Hutang Gaji            = potonganTotal  (hanya jika ada potongan)
  // Selalu balance: grossTotal = netTotal + potonganTotal.
  await postJournal(supabase, {
    tanggal: `${periode}-28`,
    deskripsi: `Penggajian ${periode}`,
    source: "payroll",
    sourceRef: periode,
    branchId: null,
    lines: [
      { code: "5201", debit: grossTotal,    credit: 0 },
      { code: "1101", debit: 0,             credit: netTotal },
      ...(potonganTotal > 0 ? [{ code: "2301", debit: 0, credit: potonganTotal }] : []),
    ],
  });

  redirect("/hris/penggajian?success=1");
}
