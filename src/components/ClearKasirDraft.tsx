"use client";

import { useEffect } from "react";
import { KASIR_DRAFT_KEY } from "@/lib/pos-draft";

export function ClearKasirDraft() {
  useEffect(() => {
    sessionStorage.removeItem(KASIR_DRAFT_KEY);
  }, []);
  return null;
}
