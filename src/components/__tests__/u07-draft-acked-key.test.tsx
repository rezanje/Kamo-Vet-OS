// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
import { useClinicDraft } from "@/components/useClinicDraft";

// U07: the inpatient log save no longer refreshes the form on the server, so browser
// Back can restore a form still holding the key that was just saved. Opening such a
// form again must mint a new key (a reused key would replay or conflict).
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); m.push.mockReset();
  window.history.replaceState(null, "", "/klinik/rawat-inap/stay/catatan");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function Harness({ requestKey, action }: { requestKey: string; action?: (form: FormData) => Promise<{ saved: boolean; href: string }> }) {
  const { attachForm, submissionKey, submit } = useClinicDraft({ userId: "doctor", scope: "inpatient:stay", requestKey, snapshot: { note: "x" }, restore: () => {} });
  return <form ref={attachForm}>
    <input type="hidden" name="request_key" value={submissionKey} readOnly />
    {action && <button type="button" id="save" onClick={() => { void submit(new FormData(), action); }}>Simpan</button>}
  </form>;
}
const key = () => container.querySelector<HTMLInputElement>("input[name=request_key]")!.value;
const settle = () => act(async () => { await Promise.resolve(); });

it("mints a fresh key when a restored form still carries a key the server already acknowledged", async () => {
  const action = vi.fn(async () => ({ saved: true, href: "/klinik/rawat-inap/stay?success=log" }));
  await act(async () => root.render(<Harness requestKey="saved-key" action={action} />));
  await settle();
  await act(async () => container.querySelector<HTMLButtonElement>("#save")!.click());
  expect(m.push).toHaveBeenCalledWith("/klinik/rawat-inap/stay?success=log");
  await act(async () => root.unmount());

  // Browser Back: the cached form comes back with the same server-rendered key.
  root = createRoot(container);
  await act(async () => root.render(<Harness requestKey="saved-key" />));
  await settle();
  expect(key()).not.toBe("saved-key");
  expect(key()).toMatch(/^[0-9a-f-]{36}$/);
});

it("keeps the server key for a fresh form and for a retry after an unacknowledged save", async () => {
  const action = vi.fn(async () => { throw new Error("lost response"); });
  await act(async () => root.render(<Harness requestKey="pending-key" action={action} />));
  await settle();
  expect(key()).toBe("pending-key");
  await act(async () => container.querySelector<HTMLButtonElement>("#save")!.click());
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Harness requestKey="pending-key" />));
  await settle();
  // Not acknowledged: the same key must be reused so the server can replay safely.
  expect(key()).toBe("pending-key");
});
