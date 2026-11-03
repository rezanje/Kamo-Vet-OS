import { expect, it } from "vitest";
import { parseRoleAccessConfig } from "../role-access-catalog";
const row = { id: "bank.cash_entry.view_history", label: "Lihat riwayat kas", group: "Kas & Bank", enforced: true };
const snapshot = { role: "STAFF", revision: "a".repeat(32), source: "defaults", modules: [], capabilities: { all_branches: false, create_accounts: false }, audit: [], actions: { source: "legacy", allowed: [row.id] }, action_catalog: [row] };
it("requires authoritative action state and catalogue, preserves dynamic supported identifiers", () => {
  expect(parseRoleAccessConfig(snapshot, "STAFF")).toEqual(snapshot);
  for (const bad of [
    { ...snapshot, actions: undefined }, { ...snapshot, action_catalog: undefined },
    { ...snapshot, actions: { source: "defaults", allowed: [] } },
    { ...snapshot, actions: { source: "custom", allowed: [row.id, row.id] } },
    { ...snapshot, actions: { source: "custom", allowed: ["unknown"] } },
    { ...snapshot, action_catalog: [row, row] },
    { ...snapshot, action_catalog: [{ ...row, enforced: "true" }] },
    { ...snapshot, action_catalog: [{ ...row, id: " bad id " }] },
    { ...snapshot, action_catalog: [{ ...row, group: "" }] },
    { ...snapshot, action_catalog: [{ ...row, label: null }] },
    { ...snapshot, action_catalog: [{ ...row, enforced: false }] },
  ]) expect(parseRoleAccessConfig(bad, "STAFF"), JSON.stringify(bad)).toBeNull();
});
it("accepts frozen mixed-case action identifiers exactly without normalization", () => {
  const id = "people.simpanKaryawan";
  expect(parseRoleAccessConfig({ ...snapshot, actions: { source: "custom", allowed: [id] }, action_catalog: [{ ...row, id }] }, "STAFF")).not.toBeNull();
});
it("unavailable planned rows are valid metadata but never supported grants", () => {
  expect(parseRoleAccessConfig({ ...snapshot, actions: { source: "custom", allowed: [] }, action_catalog: [{ ...row, enforced: false }] }, "STAFF")).not.toBeNull();
});
it("malformed audit rows fail closed without throwing during page or save reads",()=>{
 for(const audit of [["bad"],[3],[null]]) expect(parseRoleAccessConfig({...snapshot,audit},"STAFF")).toBeNull();
});
