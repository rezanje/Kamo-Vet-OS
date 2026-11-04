import { expect, it } from "vitest";
import { roundTripClient, type Call } from "@/lib/__tests__/helpers/round-trip-client";
import { bacaRombongan, bacaSaudaraKunjungan } from "@/lib/rombongan-server";
import { collectOperationalClinic } from "@/lib/operasional-klinik-server";

// Kunjungan yang diarsipkan (percobaan / dibatalkan) tidak boleh muncul sebagai "hewan yang datang bareng", ikut struk rombongan,
// atau menggembungkan laporan operasional klinik. Riwayat medis pasien sendiri tidak dibaca lewat pembaca-pembaca ini.
const isArchivedFilter = (call: Call) => call.ops.some(([op, args]) => op === "is" && args[0] === "archived_at" && args[1] === null);

it("rombongan readers skip archived visits of the same owner and day (both visits reads)", async () => {
  const rt = roundTripClient((call) => {
    if (call.name !== "visits") return { data: [] };
    return call.single
      ? { data: { id: "v1", customer_id: "c1", branch_id: "b1", created_at: "2026-11-02T03:00:00Z", customers: { name: "Pemilik" } } }
      : { data: [{ id: "v1", status: "Diperiksa", created_at: "2026-11-02T03:00:00Z", pets: { name: "A" } }, { id: "v2", status: "Menunggu", created_at: "2026-11-02T04:00:00Z", pets: { name: "B" } }] };
  });
  await bacaSaudaraKunjungan(rt.client as never, "v1");
  await bacaRombongan(rt.client as never, "v1");
  const lists = rt.calls.filter((call) => call.name === "visits" && !call.single);
  expect(lists).toHaveLength(2);
  for (const call of lists) expect(isArchivedFilter(call), JSON.stringify(call.ops)).toBe(true);
});

it("the operational clinic report does not count archived visits", async () => {
  const rt = roundTripClient((call) => {
    if (call.kind === "rpc") return { data: true };
    return { data: [], count: 0 };
  });
  await collectOperationalClinic(rt.client as never, { from: "2026-11-01", to: "2026-11-02", branchIds: ["b1"] });
  const visits = rt.calls.filter((call) => call.name === "visits");
  expect(visits).toHaveLength(1);
  expect(isArchivedFilter(visits[0])).toBe(true);
});
