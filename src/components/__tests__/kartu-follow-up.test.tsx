import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a> }));
import { KartuFollowUpDashboard } from "../KartuFollowUp";

describe("KartuFollowUpDashboard", () => {
  it("tiga angka belum dihubungi, masing-masing menaut ke tab-nya, plus tautan ke halaman", () => {
    const html = renderToStaticMarkup(<KartuFollowUpDashboard data={{ lama: 1045, grooming: 79, hariIni: 4 }} />);
    expect(html).toContain("Perlu follow up");
    expect(html).toContain("1.045"); expect(html).toContain("79"); expect(html).toContain(">4<");
    expect(html).toContain('href="/crm/follow-up?tab=lama"'); expect(html).toContain('href="/crm/follow-up?tab=grooming"'); expect(html).toContain('href="/crm/follow-up?tab=hari_ini"');
    expect(html).toContain('href="/crm/follow-up"');
    expect(html).toContain("Yang belum dihubungi");
  });
  it("tanpa akses: tidak ada apa-apa; galat: kartu pesan, bukan angka", () => {
    expect(renderToStaticMarkup(<KartuFollowUpDashboard data={null} />)).toBe("");
    const html = renderToStaticMarkup(<KartuFollowUpDashboard data={{ galat: "Daftar belum dapat dimuat." }} />);
    expect(html).toContain("data-kartu-followup-galat"); expect(html).toContain("Daftar belum dapat dimuat."); expect(html).not.toContain("data-butir");
  });
});
