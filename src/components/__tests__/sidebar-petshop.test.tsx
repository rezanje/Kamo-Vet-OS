import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AturanTersimpan } from "@/lib/akses";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
    <a {...props} data-prefetch={String(prefetch)} />,
}));
vi.mock("@/app/login/actions", () => ({ logout: vi.fn() }));

import { Sidebar } from "../Sidebar";

function render(role: string, aturan: AturanTersimpan = [], pathname = "/") {
  navigation.pathname = pathname;
  return renderToStaticMarkup(<Sidebar branches={[]} fullName="Admin Kamo" role={role} aksesModul={aturan} />);
}

describe("Petshop shortcuts in the admin sidebar", () => {
  it.each(["OWNER", "ADMIN"])("lets %s open POS and manage quests directly", (role) => {
    const html = render(role);
    expect(html).toMatch(/href="\/kasir"[^>]*data-prefetch="false"[^>]*>.*?<span>POS Petshop<\/span>/);
    expect(html).toMatch(/href="\/pos\/quest"[^>]*>.*?<span>Quest Staff<\/span>/);
    expect(html).toContain('href="/pos"');
  });

  it("hides both shortcuts when FINANCE has no access", () => {
    const html = render("FINANCE");
    expect(html).not.toContain('href="/kasir"');
    expect(html).not.toContain('href="/pos/quest"');
  });

  it("uses saved access rules for each shortcut destination", () => {
    const html = render("ADMIN", [{ role: "ADMIN", module_id: "pos" }]);
    expect(html).not.toContain('href="/kasir"');
    expect(html).toContain('href="/pos/quest"');
    const restricted = render("ADMIN", [{ role: "ADMIN", module_id: "klinik" }]);
    expect(restricted).not.toContain('href="/pos/quest"');
  });

  it("highlights Quest Staff instead of Persediaan on the quest page", () => {
    const html = render("ADMIN", [], "/pos/quest");
    expect(html).toMatch(/href="\/pos\/quest"[^>]*class="sbi on"/);
    expect(html).toMatch(/href="\/pos"[^>]*class="sbi"/);
  });
});
