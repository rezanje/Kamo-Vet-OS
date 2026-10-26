import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));

import { GET } from "../../app/api/cron/quest-jobs/route";

const request = (authorized = true) => new Request("http://localhost/api/cron/quest-jobs", {
  headers: authorized ? { authorization: "Bearer fictional-cron" } : {},
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { applied: 0, voided: 0, failed: 0, remaining: 0 }, error: null });
  vi.stubEnv("CRON_SECRET", "fictional-cron");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:55421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-service-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable staff quest retry cron", () => {
  it("requires the configured cron secret before creating a service client", async () => {
    const response = await GET(request(false));
    expect(response.status).toBe(401);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects missing service credentials", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const response = await GET(request());
    expect(response.status).toBe(501);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("drains one bounded batch and reports applied, voided and remaining jobs", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { applied: 2, voided: 1, failed: 0, remaining: 4 }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, applied: 2, voided: 1, failed: 0, remaining: 4 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("process_pending_quest_jobs", { p_limit: 50 });
  });

  it("keeps partial failures visible without exposing database details", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { applied: 1, voided: 0, failed: 1, remaining: 1 }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, applied: 1, failed: 1, remaining: 1 });
    expect(JSON.stringify(body)).not.toContain("private database detail");
  });

  it("keeps database errors private", async () => {
    mocks.rpc.mockRejectedValue(new Error("private database detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
