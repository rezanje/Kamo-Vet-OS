"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { redeemReward } from "./actions";

export function RedeemRewardForm({ userId, rewardId, afford }: { userId: string; rewardId: string; afford: boolean }) {
  return <CorrectionTransactionForm userId={userId} scope={`reward-redeem:${rewardId}`} action={redeemReward}>
    {({ ready }) => <>
      <input type="hidden" name="rewardId" value={rewardId} />
      <button type="submit" disabled={!afford || !ready}
        style={{ width: "100%", padding: "6px 0", fontSize: 10.5, fontWeight: 600, borderRadius: 7, border: "none", color: "#fff",
          background: afford ? "var(--posb)" : "#cbd5e1", opacity: afford ? 1 : 0.7, cursor: afford ? "pointer" : "not-allowed" }}>
        Tukar
      </button>
    </>}
  </CorrectionTransactionForm>;
}
