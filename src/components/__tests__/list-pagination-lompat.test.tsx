import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
import { ListPagination } from "@/components/ListPagination";
import { infoHalaman } from "@/lib/pagination";

const render = (page: number, total: number, query: Record<string, string> = {}, lompat?: boolean) =>
  renderToStaticMarkup(<ListPagination path="/klinik/rekam-medis" query={query} total={total} pageInfo={infoHalaman(page, total, 50)} lompat={lompat} />);

describe("ListPagination: lompat ke halaman", () => {
  it("menampilkan form GET ke halaman tertentu dengan filter aktif terbawa dan batas halaman", () => {
    const html = render(2, 3852, { q: "taci", pet: "", tampilan: "semua", hal: "9" });
    expect(html).toMatch(/<form[^>]*action="\/klinik\/rekam-medis"[^>]*method="get"/);
    expect(html).toContain('type="hidden" name="q" value="taci"');
    expect(html).toContain('type="hidden" name="tampilan" value="semua"');
    expect(html).not.toContain('name="pet"');
    expect(html).not.toContain('type="hidden" name="hal"');
    const angka = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? "";
    for (const attr of ['name="hal"', 'min="1"', 'max="78"', 'value="2"', "required"]) expect(angka).toContain(attr);
    expect(html).toContain("Halaman 2/78");
  });
  it("menambah tombol Pertama dan Terakhir dengan tautan yang benar", () => {
    const html = render(10, 3852, { tampilan: "semua" });
    expect(html).toMatch(/href="\/klinik\/rekam-medis\?tampilan=semua&amp;hal=1"[^>]*>Pertama/);
    expect(html).toMatch(/href="\/klinik\/rekam-medis\?tampilan=semua&amp;hal=78"[^>]*>Terakhir/);
    expect(render(1, 3852)).not.toContain("Pertama");
    expect(render(78, 3852)).not.toContain("Terakhir");
  });
  it("tidak menampilkan kotak lompat untuk daftar pendek atau bila dimatikan (daftar di dalam form lain)", () => {
    expect(render(1, 100)).not.toContain("<form");
    expect(render(1, 3852, {}, false)).not.toContain("<form");
    expect(render(1, 3852, {}, false)).toContain("Berikutnya");
  });
});
