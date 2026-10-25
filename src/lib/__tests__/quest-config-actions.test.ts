import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profile: { role: "OWNER", is_active: true } as { role: string; is_active: boolean } | null,
  writeResult: { data: { id: "saved" } as { id: string } | null, error: null as { message: string } | null },
  writes: [] as { table: string; operation: string }[],
  revalidate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "manager" } } }) },
  from: (table: string) => {
    if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile }) }) }) };
    const chain = {
      insert: () => { state.writes.push({ table, operation: "insert" }); return chain; },
      update: () => { state.writes.push({ table, operation: "update" }); return chain; },
      eq: () => chain,
      select: () => chain,
      single: async () => state.writeResult,
      maybeSingle: async () => state.writeResult,
    };
    return chain;
  },
}) }));

import { createQuestDef, createReward, fulfillRedemption, toggleReward } from "@/app/(app)/pos/quest/actions";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => {
  state.profile = { role: "OWNER", is_active: true };
  state.writeResult = { data: { id: "saved" }, error: null };
  state.writes.length = 0;
  state.revalidate.mockClear();
});

it("blocks inactive managers and staff before changing reward configuration", async () => {
  state.profile = { role: "OWNER", is_active: false };
  await expect(createReward(form({ reward_name: "Fixture", points_cost: "10" })))
    .rejects.toThrow("REDIRECT:/pos/quest?error=");
  state.profile = { role: "STAFF", is_active: true };
  await expect(toggleReward(form({ id: "reward", active: "0" })))
    .rejects.toThrow("REDIRECT:/pos/quest?error=");
  expect(state.writes).toHaveLength(0);
});

it("never reports a blocked or empty write as successful", async () => {
  state.writeResult = { data: null, error: { message: "RLS denied" } };
  await expect(createReward(form({ reward_name: "Fixture", points_cost: "10" })))
    .rejects.toThrow("REDIRECT:/pos/quest?error=");
  state.writeResult = { data: null, error: null };
  await expect(toggleReward(form({ id: "reward", active: "0" })))
    .rejects.toThrow("REDIRECT:/pos/quest?error=");
  await expect(fulfillRedemption(form({ id: "stale" })))
    .rejects.toThrow("REDIRECT:/pos/quest?error=");
  expect(state.revalidate).not.toHaveBeenCalled();
});

it("retains the authorized manager save path", async () => {
  await expect(createQuestDef(form({ title: "Fixture", target_value: "2", points_reward: "5" })))
    .rejects.toThrow("REDIRECT:/pos/quest?success=quest");
  expect(state.writes).toEqual([{ table: "staff_quest_definitions", operation: "insert" }]);
  expect(state.revalidate).toHaveBeenCalledWith("/pos/quest");
});
