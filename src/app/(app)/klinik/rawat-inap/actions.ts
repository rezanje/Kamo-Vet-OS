"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, isTerminal, ripWaMessage, type Condition, type Role } from "@/lib/inpatient";
import { stockDeductions } from "@/lib/compounding";
import { sendWA } from "@/lib/fonnte";

// Admit pasien rawat inap dari rekam medis (popup design klinik/07).
export async function admitInpatient(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const visitId = String(formData.get("visitId") ?? "");
  const treatmentPlan = String(formData.get("treatment_plan") ?? "").trim();
  const doctorName = String(formData.get("doctor_name") ?? "").trim();
  const back = `/klinik/rekam-medis/${visitId}`;
  if (!visitId || !treatmentPlan) redirect(`${back}?error=${encodeURIComponent("Isi rencana tindakan rawat inap")}`);

  const { data: visit } = await supabase.from("visits").select("branch_id, dokter").eq("id", visitId).maybeSingle();
  if (!visit) redirect(`${back}?error=${encodeURIComponent("Kunjungan tidak ditemukan")}`);

  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: rec, error } = await supabase
    .from("inpatient_records")
    .insert({
      branch_id: visit!.branch_id, visit_id: visitId, medical_record_id: mr?.id ?? null,
      doctor_name: doctorName || visit!.dokter || null, treatment_plan: treatmentPlan,
      created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !rec) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal admit rawat inap")}`);

  await supabase.from("inpatient_status_log").insert({
    inpatient_record_id: rec!.id, previous_status: null, new_status: "stabil",
    changed_by: user?.id ?? null, notes: "Admit rawat inap",
  });

  redirect(`/klinik/rawat-inap/${rec!.id}?success=admit`);
}

// Laporan harian — append-only (§3 dashboard req): entry baru, tidak pernah overwrite.
export async function addDailyLog(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const conditionNote = String(formData.get("condition_note") ?? "").trim();
  const tindakan = String(formData.get("tindakan") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const doctorName = String(formData.get("doctor_name") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !conditionNote) redirect(`${back}?error=${encodeURIComponent("Isi kondisi pasien")}`);

  const { error } = await supabase.from("inpatient_daily_logs").insert({
    inpatient_record_id: recordId, condition_note: conditionNote, tindakan, keterangan,
    doctor_name: doctorName, created_by: user?.id ?? null,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  redirect(`${back}?success=log`);
}

// Catatan harian rawat inap versi lengkap (desain POS): simpan log harian + obat/jasa
// yang diberikan (masuk ke resep visit → ikut tagihan) + opsi ubah kondisi sekalian.
type RacikBahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };
type ResepItem = {
  nama_obat: string; qty: number; satuan?: string; harga?: number; jenis?: string;
  aturan_pakai?: string; ingredients?: RacikBahan[]; dosage_form?: string;
};
export async function addDailyLogPos(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const conditionNote = String(formData.get("condition_note") ?? "").trim();
  const tindakan = String(formData.get("tindakan") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const doctorName = String(formData.get("doctor_name") ?? "").trim() || null;
  const logDate = String(formData.get("log_date") ?? "").trim();
  const logTime = String(formData.get("log_time") ?? "").trim();
  const newStatus = String(formData.get("new_status") ?? "").trim() as Condition | "";
  const cetak = String(formData.get("cetak") ?? "") === "1";
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !conditionNote) redirect(`${back}?error=${encodeURIComponent("Isi kondisi pasien")}`);

  const { data: rec } = await supabase
    .from("inpatient_records").select("condition_status, visit_id, medical_record_id").eq("id", recordId).maybeSingle();
  if (!rec) redirect(`${back}?error=${encodeURIComponent("Data rawat inap tidak ditemukan")}`);

  // 1) log harian (append-only). Tanggal+waktu dari form (default = sekarang di client).
  const stamp = logDate && logTime ? new Date(`${logDate}T${logTime}`) : null;
  const { error: logErr } = await supabase.from("inpatient_daily_logs").insert({
    inpatient_record_id: recordId, condition_note: conditionNote, tindakan, keterangan,
    doctor_name: doctorName, created_by: user?.id ?? null,
    ...(logDate ? { log_date: logDate } : {}),
    ...(stamp && !Number.isNaN(stamp.getTime()) ? { created_at: stamp.toISOString() } : {}),
  });
  if (logErr) redirect(`${back}?error=${encodeURIComponent(logErr.message)}`);

  // 2) obat/jasa → resep visit (medical_record) supaya ikut tagihan saat pulang
  let mrId = rec!.medical_record_id as string | null;
  if (!mrId) {
    const { data: mr } = await supabase.from("medical_records").select("id").eq("visit_id", rec!.visit_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    mrId = mr?.id ?? null;
  }
  let resep: ResepItem[] = [];
  try { resep = JSON.parse(String(formData.get("resep") ?? "[]")); } catch { resep = []; }
  if (mrId && resep.length) {
    const rows = resep.filter((r) => r.nama_obat?.trim()).map((r) => ({
      medical_record_id: mrId, nama_obat: r.nama_obat.trim(),
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      satuan: r.jenis === "racikan" ? "racikan" : (r.satuan?.trim() || "pcs"),
      harga: Number(r.harga) > 0 ? Number(r.harga) : 0,
      aturan_pakai: r.aturan_pakai?.trim() || null,
      // racikan ditagih sebagai baris "obat" — sama seperti jalur simpanRekamMedis.
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
    }));
    if (rows.length) await supabase.from("prescription_items").insert(rows);
  }

  // 2b) Racikan → compounding_recipes (worklist apoteker) + BOM + potong stok bahan.
  const racikan = resep.filter((r) => r.jenis === "racikan" && (r.ingredients ?? []).length > 0);
  if (mrId && racikan.length) {
    const { data: visitRow } = await supabase.from("visits").select("branch_id").eq("id", rec!.visit_id).maybeSingle();
    const { data: wh } = visitRow
      ? await supabase.from("warehouses").select("id").eq("branch_id", visitRow.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle()
      : { data: null };

    for (const r of racikan) {
      const ings = (r.ingredients ?? []).filter((b) => b.item_id && Number(b.qty) > 0);
      if (ings.length === 0) continue;
      const total = ings.reduce((a, b) => a + (Number(b.harga) || 0) * (Number(b.qty) || 0), 0);

      const { data: recipe, error: recipeErr } = await supabase
        .from("compounding_recipes")
        .insert({
          medical_record_id: mrId, recipe_name: r.nama_obat.trim(),
          dosage_instruction: r.aturan_pakai?.trim() || null,
          dosage_form: r.dosage_form || null, total_price: total,
          status: "pending", created_by: user?.id ?? null,
        })
        .select("id").single();
      if (recipeErr || !recipe) redirect(`${back}?error=${encodeURIComponent(recipeErr?.message ?? "Gagal simpan racikan")}`);

      const { error: ingErr } = await supabase.from("compounding_ingredients").insert(
        ings.map((b) => ({
          recipe_id: recipe!.id, ingredient_name: b.nama, item_id: b.item_id,
          quantity: Number(b.qty), unit: b.satuan || "pcs", unit_price: Number(b.harga) || 0,
        })),
      );
      if (ingErr) redirect(`${back}?error=${encodeURIComponent(ingErr.message)}`);

      if (wh) {
        for (const d of stockDeductions(ings.map((b) => ({ item_id: b.item_id, quantity: Number(b.qty) })))) {
          const { data: st } = await supabase.from("stock").select("qty").eq("warehouse_id", wh.id).eq("item_id", d.item_id).maybeSingle();
          if (st) await supabase.from("stock").update({ qty: Number(st.qty) - d.qty, updated_at: new Date().toISOString() }).eq("warehouse_id", wh.id).eq("item_id", d.item_id);
        }
      }
    }
  }

  // 3) ubah kondisi kalau dipilih & beda dari sekarang
  if (newStatus && ["stabil", "kritis", "sembuh", "rip"].includes(newStatus) && newStatus !== rec!.condition_status) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
    if (canTransition((me?.role ?? "STAFF") as Role, newStatus)) {
      await supabase.from("inpatient_status_log").insert({
        inpatient_record_id: recordId, previous_status: rec!.condition_status, new_status: newStatus,
        changed_by: user?.id ?? null, notes: "Diubah dari catatan harian",
      });
      await supabase.from("inpatient_records").update({
        condition_status: newStatus,
        ...(isTerminal(newStatus) ? { discharged_at: new Date().toISOString() } : {}),
      }).eq("id", recordId);
    }
  }

  redirect(cetak && mrId ? `/klinik/rekam-medis/${rec!.visit_id}/resep` : `${back}?success=log`);
}

// Ubah kondisi (stabil/kritis/sembuh/rip) — rip hanya dokter, wajib tercatat di status log.
export async function changeCondition(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const recordId = String(formData.get("recordId") ?? "");
  const newStatus = String(formData.get("new_status") ?? "") as Condition;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const back = `/klinik/rawat-inap/${recordId}`;
  if (!recordId || !["stabil", "kritis", "sembuh", "rip"].includes(newStatus)) {
    redirect(`${back}?error=${encodeURIComponent("Status tidak valid")}`);
  }

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!canTransition((me?.role ?? "STAFF") as Role, newStatus)) {
    redirect(`${back}?error=${encodeURIComponent("Transisi ke RIP hanya boleh dilakukan oleh dokter")}`);
  }

  const { data: rec } = await supabase
    .from("inpatient_records").select("condition_status").eq("id", recordId).single();
  if (!rec) redirect(`${back}?error=${encodeURIComponent("Data rawat inap tidak ditemukan")}`);
  if (rec!.condition_status === newStatus) redirect(back);

  await supabase.from("inpatient_status_log").insert({
    inpatient_record_id: recordId, previous_status: rec!.condition_status, new_status: newStatus,
    changed_by: user?.id ?? null, notes,
  });

  await supabase
    .from("inpatient_records")
    .update({
      condition_status: newStatus,
      // §3: rip/sembuh otomatis keluar dari dashboard aktif; invoice TIDAK diblokir.
      ...(isTerminal(newStatus) ? { discharged_at: new Date().toISOString() } : { discharged_at: null }),
    })
    .eq("id", recordId);

  // rip → layar review WA dulu (spec default: review sebelum kirim, bukan auto-send).
  redirect(newStatus === "rip" ? `${back}?wa=review` : `${back}?success=status`);
}

// Kirim WA duka (template khusus) setelah dokter review — trigger terpisah dari WA engine rutin.
export async function sendRipWa(formData: FormData) {
  const supabase = await createClient();
  const recordId = String(formData.get("recordId") ?? "");
  const back = `/klinik/rawat-inap/${recordId}`;

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select("condition_status, visits(pets(name), customers(name, phone), branches(name))")
    .eq("id", recordId).maybeSingle();
  if (!rec || rec.condition_status !== "rip") redirect(`${back}?error=${encodeURIComponent("WA duka hanya untuk status RIP")}`);

  type Rel<T> = T | T[] | null;
  const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
  const visit = one(rec!.visits as Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string; phone: string }>; branches: Rel<{ name: string }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const branch = one(visit?.branches ?? null);
  if (!cust?.phone) redirect(`${back}?error=${encodeURIComponent("Nomor HP pemilik tidak ada")}`);

  const result = await sendWA(cust!.phone, ripWaMessage(pet?.name ?? "anabul Anda", cust!.name, branch?.name ?? "klinik kami"));
  redirect(result.ok ? `${back}?success=wa` : `${back}?error=${encodeURIComponent("WA gagal terkirim: " + (result.reason ?? ""))}`);
}
