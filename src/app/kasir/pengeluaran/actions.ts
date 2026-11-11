"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { saveExpense, isExpenseRejection } from "@/lib/expense-save";

export async function simpanPengeluaranKasir(formData: FormData) {
  const saved = await saveExpense(formData, "cashier");
  if (isExpenseRejection(saved)) return saved;
  revalidatePath("/kasir/pengeluaran");
  revalidatePath("/pos/expense");
  revalidatePath("/buku-besar/beban");
  redirect(`/kasir/pengeluaran?success=1${transactionDraftAck(formData)}`);
}
