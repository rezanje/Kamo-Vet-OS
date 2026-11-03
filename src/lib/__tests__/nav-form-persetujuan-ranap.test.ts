import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Menu Klinik: Form Persetujuan Rawat Inap", () => {
  it("label menu memakai nama baru dan tetap menuju /klinik/persetujuan", () => {
    const nav = readFileSync(join(process.cwd(), "src/lib/nav.ts"), "utf8");
    expect(nav).toContain('label: "Form Persetujuan Rawat Inap"');
    expect(nav).toContain('href: "/klinik/persetujuan"');
    expect(nav).not.toContain('label: "Form persetujuan"');
  });
  it("judul halaman memakai nama baru", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(app)/klinik/persetujuan/page.tsx"), "utf8");
    expect(page).toContain(">FORM PERSETUJUAN RAWAT INAP</div>");
  });
});
