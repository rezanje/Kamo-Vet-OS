"use client";

import { useEffect } from "react";
import { POS_DRAFT_KEY } from "@/lib/pos-draft";

export function ClearPosDraft() {
  useEffect(() => {
    sessionStorage.removeItem(POS_DRAFT_KEY);
  }, []);
  return null;
}
