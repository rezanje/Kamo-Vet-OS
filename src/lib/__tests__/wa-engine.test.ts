import { beforeEach, describe, expect, it, vi } from "vitest";
import { jalankanWaEngine, kirimStrukWa, WA_TRIGGERS } from "../wa-engine";
import { sendWA } from "../fonnte";
import { waDatabase } from "./helpers/wa-db";

vi.mock("../fonnte", () => ({ sendWA: vi.fn(async () => ({ ok: true })) }));

const now = new Date("2026-10-03T17:05:00Z"); // 4 October, 00:05 WIB.
const settings = { id: true, is_enabled: true, ...Object.fromEntries(WA_TRIGGERS.map(([key]) => [`${key}_enabled`, true])) };
const owner = { id: "owner", name: "Pemilik Uji", phone: "08123456789", dob: "1985-10-04" };
const pet = { id: "pet", customer_id: "owner", name: "Anabul Uji", dob: "2020-10-04" };

function allTriggers() {
  return {
    wa_engine_settings: [settings],
    customers: [owner, { id: "lapsed-owner", name: "Pemilik Lama", phone: "08222222222", dob: null }],
    pets: [pet, { id: "lapsed-pet", customer_id: "lapsed-owner", name: "Anabul Lama", dob: null }],
    visits: [
      { id: "groom", customer_id: "owner", pet_id: "pet", branch_id: "branch", poli: "Grooming", created_at: "2026-09-04T03:00:00Z" },
      { id: "treatment", customer_id: "owner", pet_id: "pet", branch_id: "branch", poli: "Umum", created_at: "2026-09-27T03:00:00Z" },
    ],
    follow_ups: [
      { id: "due", customer_id: "owner", pet_id: "pet", branch_id: "branch", jenis: "Vaksin", tanggal: "2026-11-03" },
      { id: "overdue", customer_id: "owner", pet_id: "pet", branch_id: "branch", jenis: "Vaksin", tanggal: "2026-09-27" },
    ],
    sales: [{ id: "last-sale", customer_id: "lapsed-owner", created_at: "2026-08-05T03:00:00Z" }],
  };
}

describe("WA engine uses complete eligibility sources before any send", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(sendWA).mockResolvedValue({ ok: true }); });

  it("creates and records all seven existing triggers at the WIB midnight boundary", async () => {
    const db = waDatabase(allTriggers());
    expect(await jalankanWaEngine(db, now)).toEqual({ enabled: true, created: 7, sent: 7, failed: 0 });
    expect(db.logs.map((row) => row.trigger_key).sort()).toEqual(WA_TRIGGERS.map(([key]) => key).sort());
    expect(db.logs.every((row) => row.status === "sent" && typeof row.message === "string")).toBe(true);
    expect(db.logs.find((row) => row.trigger_key === "owner_birthday")?.idempotency_key).toContain("2026-10-04");
  });

  it("does not send from a settings read failure", async () => {
    const db = waDatabase(allTriggers(), { read: { wa_engine_settings: { message: "settings unavailable" } } });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/pengaturan/i);
    expect(db.logs).toEqual([]);
  });

  it("disabled settings skip eligibility reads and create no messages", async () => {
    const db = waDatabase({ ...allTriggers(), wa_engine_settings: [{ ...settings, is_enabled: false }] });
    expect(await jalankanWaEngine(db, now)).toEqual({ enabled: false, created: 0, sent: 0, failed: 0 });
    expect(db.reads.map((read) => read.table)).toEqual(["wa_engine_settings"]);
    expect(db.logs).toEqual([]);
  });

  it("reads recent activity beyond the default 1,000-row cap before deciding a lapsed reminder", async () => {
    const source = allTriggers();
    source.wa_engine_settings = [{ ...settings, ...Object.fromEntries(WA_TRIGGERS.map(([key]) => [`${key}_enabled`, key === "lapsed"])) }];
    source.sales = Array.from({ length: 1001 }, (_, index) => ({ id: `sale-${String(index).padStart(4, "0")}`, customer_id: "other", created_at: "2026-08-05T03:00:00Z" }));
    source.sales.unshift({ id: "old-sale", customer_id: "lapsed-owner", created_at: "2026-08-05T03:00:00Z" });
    source.sales.push({ id: "zz-recent", customer_id: "lapsed-owner", created_at: "2026-10-03T03:00:00Z" });
    const db = waDatabase(source);
    expect(await jalankanWaEngine(db, now)).toEqual({ enabled: true, created: 0, sent: 0, failed: 0 });
    expect(db.logs).toEqual([]);
    expect(db.reads.some((read) => read.table === "sales" && read.from === 1000)).toBe(true);
  });

  it.each(["customers", "pets", "visits", "follow_ups", "sales"])("a %s read failure aborts before creating messages", async (table) => {
    const db = waDatabase(allTriggers(), { read: { [table]: { message: "source unavailable" } } });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/data/i);
    expect(db.logs).toEqual([]);
  });

  it("a failure after the first source page aborts without sending birthdays from the earlier page", async () => {
    const source = allTriggers();
    source.customers = Array.from({ length: 501 }, (_, index) => ({ ...owner, id: `owner-${String(index).padStart(4, "0")}` }));
    const db = waDatabase(source, { page: { table: "customers", from: 500, error: { message: "page unavailable" } } });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/data/i);
    expect(db.logs).toEqual([]);
  });

  it.each([null, 4, 50_001])("rejects a missing, inconsistent or excessive source total %s", async (count) => {
    const db = waDatabase(allTriggers(), { count: { customers: count } });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/data/i);
    expect(db.logs).toEqual([]);
  });

  it("a repeated run keeps the original seven logs and does not send events twice", async () => {
    const db = waDatabase(allTriggers());
    await jalankanWaEngine(db, now);
    expect(await jalankanWaEngine(db, now)).toEqual({ enabled: true, created: 0, sent: 0, failed: 0 });
    expect(db.logs).toHaveLength(7);
    expect(db.logs.every((log) => log.status === "sent")).toBe(true);
  });

  it("a failed delivery-log insert is reported instead of claiming zero messages succeeded", async () => {
    const db = waDatabase(allTriggers(), { insert: { code: "42501", message: "write denied" } });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/catat/i);
    expect(db.logs).toEqual([]);
  });

  it("provider rejection remains one failed attempt and is not automatically resent", async () => {
    vi.mocked(sendWA).mockResolvedValue({ ok: false, reason: "provider declined" });
    const db = waDatabase(allTriggers());
    expect(await jalankanWaEngine(db, now)).toEqual({ enabled: true, created: 7, sent: 0, failed: 7 });
    expect(db.logs.every((log) => log.status === "failed" && log.error === "provider declined")).toBe(true);
    expect(await jalankanWaEngine(db, now)).toEqual({ enabled: true, created: 0, sent: 0, failed: 0 });
    expect(db.logs).toHaveLength(7);
  });

  it("a log update failure after provider acceptance stops without claiming safely completed sends", async () => {
    const db = waDatabase(allTriggers(), { update: { message: "database unavailable" } });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/status/i);
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0].status).toBe("queued");
  });

  it("an update with no visible log row cannot count as a confirmed recorded send", async () => {
    const db = waDatabase(allTriggers(), { hideUpdatedRow: true });
    await expect(jalankanWaEngine(db, now)).rejects.toThrow(/status/i);
    expect(db.logs).toHaveLength(1);
  });
});

describe("WA receipt delivery log", () => {
  const input = { invoiceNo: "QA-001", customerId: owner.id, phone: owner.phone, customerName: owner.name, total: 1000, items: [{ deskripsi: "Jasa Uji", qty: 1, harga: 1000 }] };
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(sendWA).mockResolvedValue({ ok: true }); });

  it("records a confirmed receipt once", async () => {
    const db = waDatabase(allTriggers());
    expect(await kirimStrukWa(db, input)).toEqual({ ok: true });
    expect(db.logs[0]).toMatchObject({ trigger_key: "receipt", idempotency_key: "receipt:QA-001", status: "sent" });
    expect((await kirimStrukWa(db, input)).ok).toBe(false);
    expect(db.logs).toHaveLength(1);
  });

  it("reports a settings read failure distinctly from a disabled sender", async () => {
    const db = waDatabase(allTriggers(), { read: { wa_engine_settings: { message: "database unavailable" } } });
    expect(await kirimStrukWa(db, input)).toMatchObject({ ok: false, reason: expect.stringMatching(/dibaca/i) });
    expect(db.logs).toEqual([]);
  });

  it("a failed receipt status write does not present provider acceptance as recorded success", async () => {
    const db = waDatabase(allTriggers(), { update: { message: "database unavailable" } });
    expect(await kirimStrukWa(db, input)).toMatchObject({ ok: false, reason: expect.stringMatching(/status/i) });
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0].status).toBe("queued");
  });

  it("a receipt update with no affected log row is reported", async () => {
    const db = waDatabase(allTriggers(), { hideUpdatedRow: true });
    expect(await kirimStrukWa(db, input)).toMatchObject({ ok: false, reason: expect.stringMatching(/status/i) });
    expect(db.logs).toHaveLength(1);
  });
});
