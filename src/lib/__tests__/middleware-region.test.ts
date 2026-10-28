import { describe, expect, it } from "vitest";
import { config } from "@/middleware";

// U07: middleware membaca Supabase (Seoul) di setiap klik. Edge middleware
// mengabaikan `regions` dan jalan di Singapura; hanya runtime Node.js yang
// benar-benar dijalankan di icn1.
describe("middleware config (U07 region)", () => {
  it("jalan di runtime Node.js supaya region icn1 berlaku", () => {
    expect(config.runtime).toBe("nodejs");
    expect(config.regions).toEqual(["icn1"]);
  });

  it("matcher tetap sama: cron & aset statis dikecualikan", () => {
    expect(config.matcher).toEqual([
      "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ]);
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/cron/akhir-bulan")).toBe(false);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/klinik/rawat-inap")).toBe(true);
  });
});
