import { beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "doctor" as string | null, role: "DOCTOR", active: true,
  doctorReady: true, readinessError: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: session.userId ? { id: session.userId } : null } }) },
  rpc(name: string) {
    if (name !== "clinic_doctor_custom_compound_supported") throw new Error(`Unexpected RPC ${name}`);
    return Promise.resolve({ data: session.doctorReady, error: session.readinessError ? { message: "missing readiness" } : null });
  },
  from(table: string) {
    if (table !== "profiles") throw new Error(`Unexpected table ${table}`);
    return { select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: { role: session.role, is_active: session.active }, error: null }) };
  },
}) }));
import { bolehRacikKhusus } from "../katalog-racikan-server";

beforeEach(() => { session.userId = "doctor"; session.role = "DOCTOR"; session.active = true;
  session.doctorReady = true; session.readinessError = false; });

it("lets an active doctor compose a patient-specific finished compound", async () => {
  expect(await bolehRacikKhusus()).toBe(true);
});

it("retains owner/admin access while denying staff, inactive and anonymous sessions", async () => {
  for (const role of ["OWNER", "ADMIN"]) {
    session.role = role;
    expect(await bolehRacikKhusus()).toBe(true);
  }
  session.role = "STAFF";
  expect(await bolehRacikKhusus()).toBe(false);
  session.role = "DOCTOR"; session.active = false;
  expect(await bolehRacikKhusus()).toBe(false);
  session.userId = null;
  expect(await bolehRacikKhusus()).toBe(false);
});

it("keeps the doctor editor closed until the database supports its scoped custom issue", async () => {
  session.doctorReady = false;
  expect(await bolehRacikKhusus()).toBe(false);
  session.doctorReady = true; session.readinessError = true;
  expect(await bolehRacikKhusus()).toBe(false);
  session.role = "OWNER";
  expect(await bolehRacikKhusus()).toBe(true);
});
