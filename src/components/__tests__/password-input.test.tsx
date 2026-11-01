// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { PasswordInput } from "@/components/PasswordInput";

it("password tersembunyi secara default dan tombol mata menampilkan/menyembunyikannya", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PasswordInput name="password" required defaultValue="rahasia123" />));
  const input = () => host.querySelector<HTMLInputElement>('input[name="password"]')!;
  const tombol = host.querySelector<HTMLButtonElement>("button")!;
  expect(input().type).toBe("password");
  expect(input().required).toBe(true);
  expect(tombol.type).toBe("button"); // tidak ikut mengirim formulir
  await act(async () => tombol.click());
  expect(input().type).toBe("text");
  expect(input().value).toBe("rahasia123");
  expect(tombol.getAttribute("aria-label")).toBe("Sembunyikan password");
  await act(async () => tombol.click());
  expect(input().type).toBe("password");
  await act(async () => root.unmount()); host.remove();
});
