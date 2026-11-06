import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ previewKomponenGrup: vi.fn(), konfirmasiKomponenGrup: vi.fn() }));

import { GroupComponentImport } from "./GroupComponentImport";

describe("GroupComponentImport", () => {
  const html = renderToStaticMarkup(<GroupComponentImport />);

  it("menampilkan tombol Unduh contoh yang menuju template Rincian Grup", () => {
    expect(html).toMatch(/<a[^>]*href="\/pos\/sku\/impor\/template\?jenis=rincian-grup"[^>]*>/);
    expect(html).toContain("Unduh contoh (.xlsx)");
  });

  it("menampilkan langkah-langkah bernomor dalam bahasa Indonesia", () => {
    expect(html).toContain("<ol");
    expect(html).toContain("Jenis Barang GROUP");
    expect(html).toContain("Perbarui master dan kategori");
    expect(html).toMatch(/satu baris per komponen/i);
    expect(html).toContain("tekan Cek rincian");
    expect(html).toContain("Konfirmasi");
  });

  it("menjelaskan kenapa Cek rincian abu-abu dan tetap disabled tanpa file", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Cek rincian/);
    expect(html).toContain("Tombol Cek rincian baru bisa ditekan setelah Anda memilih file");
  });

  it("mempertahankan teks asli dan tombol pilih file", () => {
    expect(html).toContain("Rincian Grup Accurate");
    expect(html).toContain("Pilih Rincian Grup .xlsx");
    expect(html).toContain("Grup baru aktif hanya setelah seluruh komponennya valid.");
  });
});
