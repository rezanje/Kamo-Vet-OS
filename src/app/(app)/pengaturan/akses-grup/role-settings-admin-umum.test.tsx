// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ saveRoleSettings: vi.fn() }));
import { NewRoleSettingsForm } from "./newRoleSettingsForm";
import { ROLE_ACCESS_CATALOG, type RoleAccessConfig } from "@/lib/role-access-catalog";
let root: Root, host: HTMLDivElement;
const JURNAL = [
  { id: "jurnal.lihat", label: "Jurnal Umum — buka halaman dan lihat jurnal (Admin Umum)", group: "Jurnal Umum", enforced: true },
  { id: "jurnal.buat_manual", label: "Jurnal Umum — buat jurnal manual (Admin Umum)", group: "Jurnal Umum", enforced: true },
  { id: "jurnal.koreksi_manual", label: "Jurnal Umum — koreksi / batalkan jurnal manual (izin khusus)", group: "Jurnal Umum", enforced: true },
  { id: "jurnal.lihat_semua_sumber", label: "Jurnal Umum — lihat jurnal dari semua sumber", group: "Jurnal Umum", enforced: true },
];
const config = (role: string): RoleAccessConfig => ({
  role, revision: "a".repeat(32), source: "defaults", modules: ROLE_ACCESS_CATALOG.map((m) => m.id),
  capabilities: { all_branches: true, create_accounts: true }, audit: [],
  actions: { source: "legacy", allowed: ["jurnal.lihat", "jurnal.buat_manual", "jurnal.lihat_semua_sumber"] },
  action_catalog: role === "ADMIN_UMUM" ? JURNAL : [],
} as RoleAccessConfig);
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("Akses Grup Admin Umum: semua modul, empat tombol Jurnal Umum terpisah (koreksi bawaan mati), catatan penjelasan", async () => {
  await act(async () => root.render(<NewRoleSettingsForm userId="owner-a" config={config("ADMIN_UMUM")} canEdit />));
  for (const m of ROLE_ACCESS_CATALOG) expect(host.querySelector<HTMLInputElement>(`input[name="mod_${m.id}"]`)?.checked, m.id).toBe(true);
  expect(host.textContent).toContain("Jurnal Umum");
  expect(host.textContent).toContain("Admin Umum:");
  const teks = host.textContent ?? "";
  for (const j of JURNAL) expect(teks).toContain(j.label);
  const kotak = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((i) => i.name.startsWith("act_jurnal."));
  expect(kotak.length).toBe(4);
  const byId = (id: string) => kotak.find((i) => i.name === `act_${id}`)!;
  expect(byId("jurnal.lihat").checked).toBe(true);
  expect(byId("jurnal.buat_manual").checked).toBe(true);
  expect(byId("jurnal.lihat_semua_sumber").checked).toBe(true);
  expect(byId("jurnal.koreksi_manual").checked).toBe(false);
});

it("peran lain tidak menampilkan tombol Jurnal Umum maupun catatan Admin Umum", async () => {
  await act(async () => root.render(<NewRoleSettingsForm userId="owner-a" config={config("ADMIN")} canEdit />));
  expect(host.textContent).not.toContain("Admin Umum:");
  expect(host.querySelectorAll('input[name^="act_jurnal."]').length).toBe(0);
});

it("tanpa hak edit semua tombol Admin Umum tidak bisa diubah", async () => {
  await act(async () => root.render(<NewRoleSettingsForm userId="admin-a" config={config("ADMIN_UMUM")} canEdit={false} />));
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.length).toBeGreaterThan(10);
  expect(boxes.every((b) => b.disabled || b.closest("fieldset")?.disabled)).toBe(true);
  expect(host.querySelector('button[type="submit"]')).toBeNull();
});
