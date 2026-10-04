import { beforeEach, expect, it, vi } from "vitest";
const result = vi.hoisted(() => ({
  data: [] as { id: string }[],
  error: null,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../master-guard", () => ({
  assertMasterAdmin: async () => ({
    from: () => ({
      update: () => ({ eq: () => ({ ...result, select: async () => result }) }),
    }),
  }),
}));
import { toggleShift } from "../../app/(app)/hris/shift/actions";
beforeEach(() => {
  result.data = [];
});
it("does not claim success when the new branch RLS denies a shift update with zero affected rows", async () => {
  const f = new FormData();
  f.set("id", "s");
  f.set("aktif", "1");
  await expect(toggleShift(f)).rejects.toThrow("error=");
});
