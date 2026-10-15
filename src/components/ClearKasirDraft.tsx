"use client";

import { useEffect } from "react";
import { bacaDraftKasir, kasirDraftKey } from "@/lib/pos-draft";

export function ClearKasirDraft({ draftContext, checkoutKey }: { draftContext?: string; checkoutKey?: string }) {
  useEffect(() => {
    if (!draftContext || !checkoutKey) return;
    try {
      const key = kasirDraftKey(draftContext);
      const draft = bacaDraftKasir(sessionStorage.getItem(key));
      if (draft?.checkoutKey === checkoutKey) sessionStorage.removeItem(key);
    } catch { /* A completed payment must still show its receipt if storage is unavailable. */ }
  }, [draftContext, checkoutKey]);
  return null;
}
