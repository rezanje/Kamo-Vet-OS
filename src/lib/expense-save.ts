import { createClient } from "@/lib/supabase/server";
import { parseLampiran } from "@/lib/dokumen";
import { hariIniWIB } from "@/lib/tanggal";

/** The database commits the document, proof and journal together, including retries. */
export async function saveExpense(formData: FormData, context: "cashier" | "backoffice") {
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const jumlah = Number(formData.get("jumlah"));
  const kategori = String(formData.get("kategori") ?? "").trim();
  const lampiran = parseLampiran(formData.get("lampiran"));
  if (!requestKey || requestKey.length > 120) throw new Error("Identitas pengeluaran belum siap. Muat ulang halaman tanpa menghapus draf.");
  if (!Number.isFinite(jumlah) || jumlah <= 0 || jumlah > 1_000_000_000_000) throw new Error("Jumlah pengeluaran harus lebih dari 0 dan valid.");
  if (Number(jumlah.toFixed(2)) !== jumlah) throw new Error("Jumlah pengeluaran maksimal 2 angka desimal.");
  if (!kategori) throw new Error("Pilih kategori dulu.");
  if (!lampiran.length) throw new Error("Lampiran bukti wajib diisi sebelum pengeluaran bisa disimpan.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_expense_atomic", {
    p_request_key: requestKey,
    p_context: context,
    // A cashier cannot choose a branch; the RPC locks and reads their open shift.
    p_branch_id: context === "cashier" ? null : String(formData.get("branchId") ?? "") || null,
    p_expense: {
      tanggal: String(formData.get("tanggal") ?? "") || hariIniWIB(), kategori,
      deskripsi: String(formData.get("deskripsi") ?? "").trim() || null,
      jumlah, metode_bayar: String(formData.get("metode_bayar") ?? "Tunai"),
      ...(context === "backoffice" && String(formData.get("account_id") ?? "").trim()
        ? { account_id: String(formData.get("account_id")).trim() } : {}),
    },
    p_attachments: lampiran,
  });
  if (error) throw new Error(error.message || "Gagal menyimpan pengeluaran. Draf tetap tersedia.");
  if (!data?.expense_id || !data?.journal_id) throw new Error("Pengeluaran dan jurnal belum terkonfirmasi lengkap. Periksa daftar lalu coba lagi dengan draf yang sama.");
  return data as { expense_id: string; journal_id: string };
}
