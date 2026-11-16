// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
import { RiwayatPasienView } from "../RiwayatPasienView";
import { RiwayatPasienHeader } from "../RiwayatPasienHeader";
import { susunProfil, type KunjunganRiwayat } from "@/lib/riwayat-pasien";

const kunjungan = (id: string, tanggal: string, extra: Partial<KunjunganRiwayat> = {}): KunjunganRiwayat => ({
  visitId: id, tanggal, cabang: "VET_CMGG", impor: false, diarsipkan: false, dokter: "drh. Uji", poli: "Poli Umum", keluhan: `Keluhan ${id}`,
  adaRekam: true, suhu: 39.4, berat: 2.6, anamnesa: `Anamnesa ${id}`, gejala: "Dehidrasi", penunjang: null, diagnosa: `Diagnosa ${id}`, terapi: "Infus",
  catatanResep: null, tindakLanjut: null, obat: [{ id: `o-${id}`, nama: "Amoxicillin", jumlah: "2 tab", aturan: "2x1" }],
  tindakan: [{ id: `t-${id}`, nama: "Konsultasi", jumlah: "1", aturan: null }], rawatInap: null, ...extra,
});
// Terbaru dulu (urutan yang diberikan server).
const DATA = [
  kunjungan("v3", "2026-11-12T03:00:00Z"),
  kunjungan("v2", "2026-10-31T03:00:00Z", { impor: true, cabang: null }),
  kunjungan("v1", "2026-10-29T03:00:00Z", { rawatInap: { id: "ri-1", aktif: false }, berat: null }),
];

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (data: KunjunganRiwayat[], cabangAktif?: string | null) => act(async () => root.render(<RiwayatPasienView kunjungan={data} cabangAktif={cabangAktif} />));
const kartu = () => [...container.querySelectorAll<HTMLElement>("[data-testid=kartu-kunjungan]")];
const bukaTombol = (teks: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(teks))!;
const terbuka = () => kartu().map((c) => c.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded") === "true");

describe("RiwayatPasienView", () => {
  it("kunjungan cabang lain dari cabang aktif: isi tampil, tombol Buka (rekam medis/rawat inap) tidak ada; cabang aktif dan impor tetap ada tombol", async () => {
    const data = [
      kunjungan("vb", "2026-11-12T03:00:00Z", { cabangId: "B", cabang: "VET_BDG", rawatInap: { id: "ri-b", aktif: false } }),
      kunjungan("va", "2026-11-11T03:00:00Z", { cabangId: "A" }),
      kunjungan("vi", "2026-11-10T03:00:00Z", { cabangId: null, impor: true, cabang: null }),
    ];
    await render(data, "A");
    await act(async () => bukaTombol("Buka semua").click());
    const href = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(href).not.toContain("/klinik/rekam-medis/vb");
    expect(href).not.toContain("/klinik/rawat-inap/ri-b");
    expect(href).toContain("/klinik/rekam-medis/va");
    expect(href).toContain("/klinik/rekam-medis/vi");
    expect(container.textContent).toContain("Anamnesa vb");
    expect(container.textContent).toContain("hanya bisa dibuka dari cabang itu");
  });

  it("tanpa cabang aktif (Semua cabang): semua tombol Buka ada", async () => {
    await render([kunjungan("vb", "2026-11-12T03:00:00Z", { cabangId: "B" })], null);
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("/klinik/rekam-medis/vb");
    expect(container.textContent).not.toContain("hanya bisa dibuka dari cabang itu");
  });

  it("urutan terbaru dulu sesuai data; hanya kunjungan terbaru yang terbuka di awal", async () => {
    await render(DATA);
    expect(kartu().map((c) => c.dataset.visit)).toEqual(["v3", "v2", "v1"]);
    expect(terbuka()).toEqual([true, false, false]);
    expect(container.textContent).toContain("Anamnesa v3");
    expect(container.textContent).not.toContain("Anamnesa v2");
  });

  it("klik kartu membuka/menutupnya tanpa mengubah kartu lain", async () => {
    await render(DATA);
    await act(async () => kartu()[1].querySelector("button")!.click());
    expect(terbuka()).toEqual([true, true, false]);
    await act(async () => kartu()[0].querySelector("button")!.click());
    expect(terbuka()).toEqual([false, true, false]);
  });

  it("Buka semua dan Tutup semua", async () => {
    await render(DATA);
    await act(async () => bukaTombol("Buka semua").click());
    expect(terbuka()).toEqual([true, true, true]);
    expect(container.textContent).toContain("Anamnesa v1");
    await act(async () => bukaTombol("Tutup semua").click());
    expect(terbuka()).toEqual([false, false, false]);
    expect(container.textContent).not.toContain("Anamnesa v3");
  });

  it("isi kartu: pemeriksaan, diagnosa, terapi, tindakan, obat; tanpa harga", async () => {
    await render(DATA);
    const teks = kartu()[0].textContent!;
    for (const kata of ["Suhu 39,4 °C", "Berat 2,6 kg", "Dehidrasi", "Diagnosa v3", "Infus", "Konsultasi", "Amoxicillin · 2 tab", "(2x1)"]) expect(teks).toContain(kata);
    expect(teks).not.toMatch(/Rp|harga/i);
  });

  it("label Impor (tanpa cabang) dan Rawat inap + tautan", async () => {
    await render(DATA);
    await act(async () => bukaTombol("Buka semua").click());
    const impor = kartu()[1];
    expect(impor.textContent).toContain("Impor");
    expect(impor.textContent).not.toContain("VET_CMGG");
    expect(kartu()[0].textContent).not.toContain("Impor");
    const ranap = kartu()[2];
    expect(ranap.textContent).toContain("Rawat inap");
    expect(ranap.querySelector("a[href='/klinik/rawat-inap/ri-1']")).not.toBeNull();
    expect(kartu()[0].querySelector("a[href^='/klinik/rawat-inap']")).toBeNull();
  });

  it("tautan 'Buka rekam medis lengkap' menuju detail kunjungan yang tepat", async () => {
    await render(DATA);
    await act(async () => bukaTombol("Buka semua").click());
    const hrefs = kartu().map((c) => [...c.querySelectorAll("a")].find((a) => a.textContent?.includes("Buka rekam medis lengkap"))!.getAttribute("href"));
    expect(hrefs).toEqual(["/klinik/rekam-medis/v3", "/klinik/rekam-medis/v2", "/klinik/rekam-medis/v1"]);
  });

  it("kunjungan tanpa isi klinis tetap tampil dengan pesan, bukan kosong", async () => {
    await render([kunjungan("v9", "2026-11-12T03:00:00Z", { adaRekam: false, suhu: null, berat: null, anamnesa: null, gejala: null, diagnosa: null, terapi: null, obat: [], tindakan: [] })]);
    expect(container.textContent).toContain("belum terbaca");
    expect(container.textContent).toContain("Buka rekam medis lengkap");
  });

  it("keadaan kosong: 'Belum ada riwayat', tanpa tombol buka/tutup", async () => {
    await render([]);
    expect(container.textContent).toContain("Belum ada riwayat");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("RiwayatPasienHeader", () => {
  const profil = susunProfil({
    id: "pet-a", name: "choco", species: "Kucing", breed: "DSH", dob: "2024-08-10", gender: "jantan", weight: 2.6, alergi: "Ayam", sterilisasi: "Steril",
    kondisi_khusus: null, golongan_darah: "A", microchip: "123", customers: { name: "tes", phone: "0812000" },
  }, [{ id: "pet-b", name: "Mimi", species: "Kucing" }], () => false, new Date("2026-11-16T00:00:00Z"));

  it("profil lengkap + chip hewan lain menuju riwayat hewan itu", () => {
    const html = renderToStaticMarkup(<RiwayatPasienHeader profil={profil} kunjungan={DATA} />);
    for (const kata of ["choco", "Kucing · DSH", "Jantan", "2 th 3 bln", "2,6 kg", "Ayam", "Steril", "tes", "0812000", "Hewan lain milik pemilik ini"]) expect(html).toContain(kata);
    expect(html).toContain('href="/klinik/rekam-medis/pasien/pet-b"');
  });

  it("deret berat: urut dari terlama, null tampil '—', grafik hanya dari titik terisi", () => {
    const data = [
      kunjungan("v3", "2026-11-12T03:00:00Z", { berat: 3.1 }),
      kunjungan("v2", "2026-10-31T03:00:00Z", { berat: null }),
      kunjungan("v1", "2026-10-29T03:00:00Z", { berat: 2.6 }),
    ];
    const html = renderToStaticMarkup(<RiwayatPasienHeader profil={profil} kunjungan={data} />);
    const bagian = html.slice(html.indexOf("berat-per-kunjungan"));
    expect(bagian.indexOf("2,6 kg")).toBeLessThan(bagian.indexOf("—"));
    expect(bagian.indexOf("—")).toBeLessThan(bagian.indexOf("3,1 kg"));
    expect(html).toContain("<polyline");
  });

  it("tanpa satu pun berat: kartu berat tidak tampil; satu titik: tanpa grafik", () => {
    const tanpa = renderToStaticMarkup(<RiwayatPasienHeader profil={profil} kunjungan={[kunjungan("v1", "2026-10-29T03:00:00Z", { berat: null })]} />);
    expect(tanpa).not.toContain("berat-per-kunjungan");
    const satu = renderToStaticMarkup(<RiwayatPasienHeader profil={profil} kunjungan={[kunjungan("v1", "2026-10-29T03:00:00Z", { berat: 2.6 })]} />);
    expect(satu).toContain("berat-per-kunjungan");
    expect(satu).not.toContain("<polyline");
  });

  it("profil tanpa data: semua kolom '—' tanpa error", () => {
    const kosong = susunProfil({ id: "p", name: null, species: null, breed: null, dob: null, gender: null, weight: null, alergi: null, sterilisasi: null, kondisi_khusus: null, golongan_darah: null, microchip: null, customers: null }, [], () => false);
    const html = renderToStaticMarkup(<RiwayatPasienHeader profil={kosong} kunjungan={[]} />);
    expect(html).toContain("—");
    expect(html).not.toContain("Hewan lain");
  });
});
