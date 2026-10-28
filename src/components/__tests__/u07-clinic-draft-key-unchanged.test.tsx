// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
import { useClinicDraft } from "@/components/useClinicDraft";

// U07 review: the shared clinic draft hook (RekamForm, PembayaranForm, CatatanForm) keeps
// the server-issued request key. An identical re-save from a restored form must replay
// the stored row through that key, never mint a new key that would create a second row.
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); m.push.mockReset();
  window.history.replaceState(null, "", "/klinik/rekam-medis/visit");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function Harness({ scope, requestKey, action }: { scope: string; requestKey: string; action?: (form: FormData) => Promise<{ saved: boolean; href: string }> }) {
  const { attachForm, submissionKey, submit } = useClinicDraft({ userId: "doctor", scope, requestKey, snapshot: { note: "x" }, restore: () => {} });
  return <form ref={attachForm}>
    <input type="hidden" name="request_key" value={submissionKey} readOnly />
    {action && <button type="button" id="save" onClick={() => { void submit(new FormData(), action); }}>Simpan</button>}
  </form>;
}
const key = () => container.querySelector<HTMLInputElement>("input[name=request_key]")!.value;
const settle = () => act(async () => { await Promise.resolve(); });

it.each(["visit:visit", "payment:visit", "inpatient:stay"])("%s: a form restored after an acknowledged save keeps the server key", async (scope) => {
  const action = vi.fn(async () => ({ saved: true, href: "/klinik/pembayaran/visit" }));
  await act(async () => root.render(<Harness scope={scope} requestKey="server-key" action={action} />));
  await settle();
  await act(async () => container.querySelector<HTMLButtonElement>("#save")!.click());
  expect(m.push).toHaveBeenCalledWith("/klinik/pembayaran/visit");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Harness scope={scope} requestKey="server-key" />));
  await settle();
  expect(key()).toBe("server-key");
  expect(Object.keys(sessionStorage)).toEqual([]);
});

it("the hook keeps no list of acknowledged keys and never mints keys on open", () => {
  const source = readFileSync("src/components/useClinicDraft.ts", "utf8");
  expect(source).not.toMatch(/acked/i);
  expect(source.match(/crypto\.randomUUID\(\)/g)).toHaveLength(1); // only the explicit "discard draft"
});
