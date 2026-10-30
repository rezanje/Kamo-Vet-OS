// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FolderDropZone } from "../FolderDropZone";
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("menerima beberapa folder dalam satu drop dan mempertahankan jalur pemilik", async () => {
  const choose = vi.fn(); const busy = vi.fn(); const error = vi.fn();
  await act(async () => root.render(<FolderDropZone disabled={false} onChoose={choose} onBusy={busy} onError={error} />));
  const make = (name: string) => ({ name, isFile: false, isDirectory: true, createReader: () => {
    let done = false;
    return { readEntries: (ok: (entries: unknown[]) => void) => {
      ok(done ? [] : [{ name: "Kartu.xlsx", isFile: true, isDirectory: false,
        file: (callback: (f: File) => void) => callback(new File(["test"], "Kartu.xlsx")) }]); done = true;
    } };
  } });
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { items: ["Budi - 0812", "Ani - 0813"].map((name) => ({ kind: "file", webkitGetAsEntry: () => make(name) })) } });
  await act(async () => { container.querySelector('[aria-label="Taruh folder rekam medis"]')!.dispatchEvent(event); });
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose.mock.calls[0][0].map((f: File) => f.webkitRelativePath)).toEqual(["Budi - 0812/Kartu.xlsx", "Ani - 0813/Kartu.xlsx"]);
  expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
  expect(error).not.toHaveBeenCalled();
});

it("menolak drop saat impor berjalan tanpa mengubah pilihan", async () => {
  const choose = vi.fn(); const busy = vi.fn(); const error = vi.fn();
  await act(async () => root.render(<FolderDropZone disabled onChoose={choose} onBusy={busy} onError={error} />));
  const event = new Event("drop", { bubbles: true, cancelable: true });
  await act(async () => { container.querySelector('[aria-label="Taruh folder rekam medis"]')!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(choose).not.toHaveBeenCalled(); expect(busy).not.toHaveBeenCalled();
});
it("tidak mengimpor diam-diam jika browser tidak menyediakan akses folder", async () => {
  const choose = vi.fn(); const error = vi.fn();
  await act(async () => root.render(<FolderDropZone disabled={false} onChoose={choose} onBusy={vi.fn()} onError={error} />));
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { items: [{ kind: "file", webkitGetAsEntry: () => null }] } });
  await act(async () => { container.querySelector('[aria-label="Taruh folder rekam medis"]')!.dispatchEvent(event); });
  expect(choose).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(1);
});
