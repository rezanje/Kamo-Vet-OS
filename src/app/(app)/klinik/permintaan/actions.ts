"use server";

import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { loadMasterPermintaan, parseBarisInput, siapkanBaris } from "@/lib/permintaan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function buatPermintaanKlinik(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  const from_branch_id = shift?.branch_id ?? String(formData.get("from_branch_id") ?? "");
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const priority = String(formData.get("priority") ?? "normal") === "tinggi" ? "tinggi" : "normal";
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const requestKey = String(formData.get("request_key") ?? "");
  const back = "/klinik/permintaan/baru";

  const input = parseBarisInput(formData.get("items"));
  const master = await loadMasterPermintaan(supabase, input.map((item) => String(item.item_id ?? "")));
  const prepared = siapkanBaris(input, master);

  if (!from_branch_id || !to_warehouse_id || prepared.error) {
    redirect(`${back}?error=${encodeURIComponent(prepared.error ?? "Gudang tujuan & minimal 1 item wajib diisi")}`);
  }

  // Anisa 2 Nov: permintaan ke DC / gudang cabang lain ditolak karena gudang tujuan tersembunyi
  // dari cabang aktif. Database yang memeriksa shift klinik, gudang tujuan dan rincian, lalu
  // menyimpan header + baris + nomor dalam satu transaksi (padanan kasir petshop).
  if (shift && UUID.test(requestKey)) {
    const { data: requestId, error } = await supabase.rpc("create_clinic_stock_request_atomic", {
      p_key: requestKey, p_branch_id: shift.branch_id, p_to_warehouse_id: to_warehouse_id, p_priority: priority, p_notes: catatan,
      p_items: input.filter((row) => row?.item_id && Number(row.qty_diminta) > 0).map((row) => ({
        item_id: String(row.item_id), qty_diminta: Number(row.qty_diminta), satuan: row.satuan ?? "", catatan: row.catatan ?? "",
      })),
    });
    if (!error && requestId) redirect(`/klinik/permintaan?success=1${transactionDraftAck(formData)}`);
    // Fungsinya belum terpasang di database: lanjut jalur lama apa adanya.
    if (error?.code !== "PGRST202") {
      redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Hasil simpan permintaan belum terkonfirmasi. Periksa daftar permintaan sebelum mengirim ulang.")}`);
    }
  }

  // Formatnya dibaca dari master penomoran; bawaannya PRM-YYYYMMDD-NNNN,
  // dilanjutkan dari nomor tertinggi hari itu.
  const { nomor: no_request } = await nomorBerikutnya(supabase, "PRM", hariIniWIB(), {
    table: "stock_requests", column: "no_request",
  });

  const { data: req, error } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id, to_warehouse_id, priority, catatan, requested_by: user.id })
    .select("id").single();
  if (error || !req) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal simpan permintaan")}`);

  const { error: itemsError } = await supabase.from("stock_request_items").insert(
    prepared.rows.map((item) => ({ request_id: (req as { id: string }).id, ...item })),
  );

  if (itemsError) redirect(`${back}?error=${encodeURIComponent("Baris permintaan belum terkonfirmasi. Periksa daftar permintaan sebelum menyimpan ulang.")}`);

  redirect(`/klinik/permintaan?success=1${transactionDraftAck(formData)}`);
}
