import { expect, it } from "vitest";
import { queueDayBounds } from "@/lib/queue";
it("uses a half-open WIB day regardless of server timezone, including final milliseconds", () => {
  expect(queueDayBounds("2026-10-14")).toEqual({ date: "2026-10-14", from: "2026-10-13T17:00:00.000Z", until: "2026-10-14T17:00:00.000Z" });
  expect(queueDayBounds("2026-12-31")?.until).toBe("2026-12-31T17:00:00.000Z");
});
it("rejects malformed and impossible calendar dates", () => {
  for (const date of ["bad", "2026-02-30", "2026-13-01", "2026-1-01"]) expect(queueDayBounds(date)).toBeNull();
  expect(queueDayBounds("2028-02-29")?.date).toBe("2028-02-29");
});
