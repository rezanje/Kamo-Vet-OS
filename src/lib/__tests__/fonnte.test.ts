import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWA } from "../fonnte";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("hasil provider WhatsApp", () => {
  it("respons kosong tidak dianggap terkirim", async () => {
    vi.stubEnv("FONNTE_TOKEN", "test-only");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    expect((await sendWA("08123456789", "uji")).ok).toBe(false);
  });
  it("konfirmasi positif diterima dan nomor dinormalisasi", async () => {
    vi.stubEnv("FONNTE_TOKEN", "test-only");
    const request = vi.fn(async () => Response.json({ status: true }));
    vi.stubGlobal("fetch", request);
    expect((await sendWA("08123456789", "uji")).ok).toBe(true);
    expect(request).toHaveBeenCalledWith("https://api.fonnte.com/send", expect.objectContaining({ body: JSON.stringify({ target: "628123456789", message: "uji" }) }));
  });
});
