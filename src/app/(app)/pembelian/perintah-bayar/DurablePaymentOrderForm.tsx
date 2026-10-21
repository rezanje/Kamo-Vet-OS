"use client";

import type { ReactNode, CSSProperties } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";

export function DurablePaymentOrderForm({ userId, scope, action, children, style }: {
  userId: string; scope: string; action: (data: FormData) => Promise<void>; children: ReactNode; style?: CSSProperties;
}) {
  return <CorrectionTransactionForm userId={userId} scope={scope} action={action} style={style}>
    {({ ready }) => <fieldset disabled={!ready} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "contents" }}>{children}</fieldset>}
  </CorrectionTransactionForm>;
}
