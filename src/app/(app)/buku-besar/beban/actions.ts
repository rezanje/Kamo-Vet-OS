"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { saveExpense, isExpenseRejection } from "@/lib/expense-save";

const back = "/buku-besar/beban";

export async function catatBeban(formData: FormData) {
  const payload = new FormData();
  for (const [key, value] of formData.entries()) payload.append(key, value);
  payload.set("branchId", String(formData.get("branch_id") ?? ""));
  payload.set("metode_bayar", String(formData.get("metode") ?? "Tunai"));
  const saved = await saveExpense(payload, "backoffice");
  if (isExpenseRejection(saved)) return saved;
  revalidatePath(back);
  revalidatePath("/pos/expense");
  redirect(`${back}?success=1${transactionDraftAck(formData)}`);
}
