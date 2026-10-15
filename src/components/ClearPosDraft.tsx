"use client";

import { useEffect } from "react";
import { bacaDraftPos, POS_DRAFT_KEY } from "@/lib/pos-draft";

export function ClearPosDraft({ checkoutKey }: { checkoutKey?: string }) {
  useEffect(() => {
    if (!checkoutKey) return;
    try {
      const draft = bacaDraftPos(sessionStorage.getItem(POS_DRAFT_KEY));
      if (draft?.checkoutKey === checkoutKey) sessionStorage.removeItem(POS_DRAFT_KEY);
    } catch { /* A confirmed receipt stays available when browser storage is blocked. */ }
  }, [checkoutKey]);
  return null;
}
