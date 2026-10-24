// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ simpanEditPengguna: save }));
import { UserAccountEditForm } from "@/app/(app)/pengaturan/pengguna/[id]/edit/UserAccountEditForm";
import type { UserAccountEditSnapshot } from "@/lib/user-account-edit";
const id = "a0000000-0000-4000-8000-000000000001", active = "a0000000-0000-4000-8000-000000000002", old = "a0000000-0000-4000-8000-000000000003", request = "a0000000-0000-4000-8000-000000000004";
const snapshot: UserAccountEditSnapshot = { profile_id: id, full_name: "Nama akun tersimpan", role: "STAFF", is_active: false, branch_ids: [old], version: "saved-version", editable_roles: ["STAFF", "DOCTOR"], self: false };
const branches = [{ id: active, name: "Cabang aktif", is_active: true }, { id: old, name: "Cabang lama", is_active: false, legacy: true }];
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); save.mockReset(); save.mockResolvedValue({ ok: false, message: "Akun sudah berubah. Isian tetap ada." }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(value = snapshot) { await act(async () => root.render(<UserAccountEditForm snapshot={value} branches={branches} requestId={request} />)); }
function form() { return host.querySelector("form")!; }
async function rename(value: string) { await act(async () => { const input = host.querySelector<HTMLInputElement>('[name="full_name"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
it("prefills the exact account identity, existing branches and only server-provided role options", async () => {
  await render(); const data = new FormData(form());
  expect(data.get("profile_id")).toBe(id); expect(data.get("full_name")).toBe(snapshot.full_name); expect(data.get("role")).toBe("STAFF"); expect(data.getAll("branch_ids")).toEqual([old]);
  expect([...host.querySelectorAll("select[name=role] option")].map((o) => o.getAttribute("value"))).toEqual(["STAFF", "DOCTOR"]);
  expect(host.textContent).toContain("Nonaktif");
  for (const forbidden of ["email", "password", "is_active", "employee_id"]) expect(form().querySelector(`[name="${forbidden}"]`)).toBeNull();
});
it("submits changed name, role and explicit branch choices, preserving dirty fields and request identity on rejection", async () => {
  await render(); await rename("Nama yang belum tersimpan");
  await act(async () => { const select = host.querySelector<HTMLSelectElement>('[name="role"]')!; select.value = "DOCTOR"; select.dispatchEvent(new Event("change", { bubbles: true })); host.querySelector<HTMLInputElement>(`input[type=checkbox][value="${active}"]`)!.click(); });
  expect(new FormData(form()).get("role")).toBe("DOCTOR");
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(save).toHaveBeenCalledTimes(1); const sent = save.mock.calls[0][0] as FormData;
  expect(sent.get("full_name")).toBe("Nama yang belum tersimpan"); expect(sent.get("role")).toBe("DOCTOR"); expect(sent.getAll("branch_ids")).toEqual([active, old]);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("sudah berubah");
  const remaining = new FormData(form()); for (const key of ["full_name", "role", "expected_version", "request_id"]) expect(remaining.get(key)).toBe(sent.get(key));
  expect(remaining.getAll("branch_ids")).toEqual(sent.getAll("branch_ids"));
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect((save.mock.calls[1][0] as FormData).get("request_id")).toBe(request);
});
it("allows self name edits while submitting the unchanged disabled role and branches", async () => {
  await render({ ...snapshot, role: "ADMIN", editable_roles: [], self: true }); await rename("Nama sendiri baru");
  expect(host.querySelector<HTMLSelectElement>("select[name=role]")!.disabled).toBe(true);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.disabled)).toBe(true);
  const data = new FormData(form()); expect(data.get("full_name")).toBe("Nama sendiri baru"); expect(data.get("role")).toBe("ADMIN"); expect(data.getAll("branch_ids")).toEqual([old]);
});
it("keeps the original request identity when the same stored snapshot is rerendered", async () => {
  await render(); await rename("Nama masih diedit");
  await act(async () => root.render(<UserAccountEditForm snapshot={snapshot} branches={branches} requestId="a0000000-0000-4000-8000-000000000099" />));
  const data = new FormData(form()); expect(data.get("request_id")).toBe(request); expect(data.get("full_name")).toBe("Nama masih diedit");
});
it("retains edits after a transport failure before the action response arrives", async () => {
  save.mockRejectedValue(new Error("private transport detail")); await render(); await rename("Nama dicoba ulang");
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(new FormData(form()).get("full_name")).toBe("Nama dicoba ulang"); expect(new FormData(form()).get("request_id")).toBe(request);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("belum dapat dipastikan"); expect(host.textContent).not.toContain("private transport detail");
});
