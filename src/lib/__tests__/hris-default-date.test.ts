import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/app/(app)/hris/absensi/page.tsx",
  "src/app/(app)/hris/absensi/actions.ts",
  "src/app/(app)/hris/karyawan/actions.ts",
].map((file) => readFileSync(resolve(process.cwd(), file), "utf8"));

describe("tanggal default HRIS", () => {
  it("menggunakan hari WIB dan tidak menyimpan tanggal pilot", () => {
    for (const source of files) {
      expect(source).toContain("hariIniWIB");
      expect(source).not.toContain("2026-07-01");
    }
  });
});

