import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ engine: vi.fn(), guard: vi.fn(), client: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/wa-engine", () => ({ jalankanWaEngine: mocks.engine }));
vi.mock("@/lib/master-guard", () => ({ assertRole: mocks.guard }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET } from "../../app/api/cron/wa-engine/route";
import { jalankanWaManual } from "../../app/(app)/pengaturan/wa-engine/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({});
  mocks.client.mockReturnValue({});
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`Redirect: ${url}`); });
  mocks.engine.mockResolvedValue({ enabled: true, created: 2, sent: 1, failed: 1 });
  vi.stubEnv("CRON_SECRET", "fictional-cron");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:55421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-service-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("WA run callers expose incomplete execution", () => {
  it("cron returns unauthorized for a request without its configured secret", async () => {
    const response = await GET(new Request("http://localhost/api/cron/wa-engine"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("cron returns unavailable without leaking underlying failure details", async () => {
    mocks.engine.mockRejectedValue(new Error("private provider or database detail"));
    const response = await GET(new Request("http://localhost/api/cron/wa-engine", { headers: { authorization: "Bearer fictional-cron" } }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/riwayat/);
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("manual run returns to settings with its actionable failure instead of a success banner", async () => {
    mocks.engine.mockRejectedValue(new Error("Data WA berubah saat dibaca."));
    await expect(jalankanWaManual()).rejects.toThrow(`Redirect: /pengaturan/wa-engine?error=${encodeURIComponent("Data WA berubah saat dibaca.")}`);
  });

  it("manual success shows the actual confirmed and failed counts", async () => {
    await expect(jalankanWaManual()).rejects.toThrow("Redirect: /pengaturan/wa-engine?success=run&sent=1&failed=1&created=2");
  });
});
