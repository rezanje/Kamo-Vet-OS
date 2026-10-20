"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { saveExpense } from "@/lib/expense-save";
import { createClient } from "@/lib/supabase/server";

export async function simpanExpense(formData: FormData) {
  await saveExpense(formData, "backoffice");
  revalidatePath("/kasir/pengeluaran");
  revalidatePath("/pos/expense");
  revalidatePath("/buku-besar/beban");
  redirect(`/pos/expense?success=1${transactionDraftAck(formData)}`);
}

async function correctExpense(formData: FormData, kind: "edit" | "void") {
  const id = String(formData.get("id") ?? "");
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const revision = Number(formData.get("revision"));
  const reason = String(formData.get("alasan") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || !requestKey || requestKey.length > 120 || !Number.isSafeInteger(revision) || revision < 0) throw new Error("Identitas koreksi pengeluaran tidak valid. Muat ulang detail.");
  if (reason.length < 3 || reason.length > 1000) throw new Error("Alasan koreksi wajib diisi (3–1000 karakter).");
  const jumlah = Number(formData.get("jumlah"));
  if (kind === "edit" && (!Number.isFinite(jumlah) || jumlah <= 0 || jumlah > 1_000_000_000_000)) throw new Error("Jumlah pengeluaran harus lebih dari 0 dan valid.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revise_expense_atomic", {
    p_request_key: requestKey, p_expense_id: id, p_expected_revision: revision, p_action: kind, p_reason: reason,
    p_expense: kind === "void" ? {} : {
      tanggal: String(formData.get("tanggal") ?? ""), kategori: String(formData.get("kategori") ?? ""),
      deskripsi: String(formData.get("deskripsi") ?? "").trim() || null, jumlah,
      metode_bayar: String(formData.get("metode_bayar") ?? ""),
    },
  });
  if (error) throw new Error(error.message || "Koreksi pengeluaran gagal. Isian tetap tersedia.");
  if (!data?.expense_id || !data?.journal_id) throw new Error("Koreksi dan jurnal belum terkonfirmasi lengkap.");
  const back = formData.get("kembali") === "/buku-besar/beban" ? "/buku-besar/beban" : "/pos/expense";
  for (const path of ["/kasir/pengeluaran", "/pos/expense", "/buku-besar/beban", `/pos/expense/${id}`, `/buku-besar/beban/${id}`]) revalidatePath(path);
  redirect(`${back}/${id}?success=${kind}${transactionDraftAck(formData)}`);
}

export async function ubahExpense(formData: FormData) { await correctExpense(formData, "edit"); }
export async function batalkanExpense(formData: FormData) { await correctExpense(formData, "void"); }

export async function periksaExpense(formData: FormData) {
  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!requestKey || requestKey.length > 120) throw new Error("Identitas pengeluaran belum siap.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_expense_posting_result", { p_request_key: requestKey });
  if (error) throw new Error(error.message || "Hasil simpan belum dapat diperiksa. Draf tetap tersedia.");
  if (!data?.expense_id || !data?.journal_id) throw new Error("Belum ada pengeluaran terkonfirmasi untuk draf ini. Isian tetap tersedia; simpan kembali dari draf yang sama.");
  const scope = String(formData.get("draft_scope") ?? "");
  const back = scope.startsWith("cashier-expense:") ? "/kasir/pengeluaran"
    : scope === "backoffice-expense" || scope === "book-expense" ? (scope === "book-expense" ? "/buku-besar/beban" : "/pos/expense")
      : `${formData.get("kembali") === "/buku-besar/beban" ? "/buku-besar/beban" : "/pos/expense"}/${encodeURIComponent(String(data.expense_id))}`;
  formData.set("draft_key", requestKey);
  redirect(`${back}?success=1${transactionDraftAck(formData)}`);
}
