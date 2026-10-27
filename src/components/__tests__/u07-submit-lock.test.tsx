// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("react-dom", async () => ({
  ...await vi.importActual<typeof import("react-dom")>("react-dom"),
  useFormStatus: () => ({ pending: false }),
}));
import { useClinicDraft } from "@/components/useClinicDraft";
import { SubmitButton } from "@/components/SubmitButton";

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); m.push.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function Harness({ action }: { action: (form: FormData) => Promise<{ saved: boolean; href: string }> }) {
  const { attachForm, submit, leaving } = useClinicDraft({ userId: "doctor", scope: "u07", requestKey: "stable", snapshot: { note: "x" }, restore: () => {} });
  return <form ref={attachForm}>
    <button type="button" id="twice" onClick={() => { void submit(new FormData(), action); void submit(new FormData(), action); }}>Simpan dua kali</button>
    <SubmitButton busy={leaving}>Simpan</SubmitButton>
  </form>;
}

it("sends one save for a double click and keeps the button locked while the next page opens", async () => {
  let resolve!: (value: { saved: boolean; href: string }) => void;
  const action = vi.fn(() => new Promise<{ saved: boolean; href: string }>((r) => { resolve = r; }));
  await act(async () => root.render(<Harness action={action} />));
  await act(async () => container.querySelector<HTMLButtonElement>("#twice")!.click());
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ saved: true, href: "/klinik/pembayaran/visit" }));
  expect(m.push).toHaveBeenCalledWith("/klinik/pembayaran/visit");
  const submit = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
  expect(submit.disabled).toBe(true);
  expect(submit.getAttribute("aria-busy")).toBe("true");
  expect(submit.textContent).toContain("Tersimpan");
});

it("does not render the current page twice when the destination is the page already refreshed by the save", async () => {
  window.history.replaceState(null, "", "/klinik/rekam-medis/visit");
  const action = vi.fn(async () => ({ saved: true, href: "/klinik/rekam-medis/visit" }));
  await act(async () => root.render(<Harness action={action} />));
  await act(async () => container.querySelector<HTMLButtonElement>("#twice")!.click());
  expect(action).toHaveBeenCalledTimes(1);
  expect(m.push).not.toHaveBeenCalled();
  // No phantom 20s "opening page" lock, and a later click cannot resurrect the cleared draft.
  const submit = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
  expect(submit.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>("#twice")!.click());
  expect(sessionStorage.getItem("vetos:clinic-draft:v1:doctor:u07")).toBeNull();
});

it("a failed save unlocks for a retry with the same key", async () => {
  const action = vi.fn(async () => { throw new Error("lost response"); });
  await act(async () => root.render(<Harness action={action} />));
  await act(async () => container.querySelector<HTMLButtonElement>("#twice")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>("#twice")!.click());
  expect(action).toHaveBeenCalledTimes(2);
  expect(container.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(false);
});
