"use client";

import { useEffect } from "react";
import { bacaDraftKasir, kasirDraftKey } from "@/lib/pos-draft";

export function ClearKasirDraft({ draftContext, checkoutKey }: { draftContext?: string; checkoutKey?: string }) {
  useEffect(() => {
    if (!draftContext || !checkoutKey) return;
    try {
      const key = kasirDraftKey(draftContext);
      const keys = [key, ...Object.keys(sessionStorage).filter(candidate => candidate.startsWith(`${key}:replacement:`))];
      for (const candidate of keys) {
        const draft = bacaDraftKasir(sessionStorage.getItem(candidate));
        if (draft?.checkoutKey === checkoutKey) sessionStorage.removeItem(candidate);
      }
    } catch { /* A completed payment must still show its receipt if storage is unavailable. */ }
  }, [draftContext, checkoutKey]);
  return null;
}
