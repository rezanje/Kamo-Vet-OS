import { describe, expect, it } from "vitest";
import { BILLING_LUNAS_LABEL, BILLING_UNREAD } from "./inpatient-billing-status";
import {
  canSeeLaporanTertinggal,
  daysBetween,
  groupLogsByRecord,
  isLunasBelumPulang,
  laporanHarian,
  laporanTertinggal,
  readDailyLogsBatched,
  wibDate,
  type DailyLogRow,
} from "./inpatient-daily-report";

const bill = (label: string) => ({ label, badge: "o", action: "x" });
const log = (record: string, log_date: string | null, created_at = "2026-11-06T03:00:00Z"): DailyLogRow => ({ inpatient_record_id: record, log_date, created_at });

describe("BILLING_LUNAS_LABEL", () => {
  it("memakai label yang sama dengan kolom Tagihan", () => {
    expect(BILLING_LUNAS_LABEL).toBe("Lunas");
  });
});

describe("isLunasBelumPulang — sinyal sama dengan kolom Tagihan 'Lunas'", () => {
  const aktif = { discharged_at: null };
  it("aktif + Lunas → true", () => expect(isLunasBelumPulang(aktif, bill("Lunas"))).toBe(true));
  it("sudah dipulangkan + Lunas → false", () => expect(isLunasBelumPulang({ discharged_at: "2026-11-05T01:00:00Z" }, bill("Lunas"))).toBe(false));
  it("aktif + DP (sebagian) → false", () => expect(isLunasBelumPulang(aktif, bill("DP"))).toBe(false));
  it("aktif + Belum lunas → false", () => expect(isLunasBelumPulang(aktif, bill("Belum lunas"))).toBe(false));
  it("aktif + tanpa tagihan → false", () => expect(isLunasBelumPulang(aktif, bill("Belum ada tagihan"))).toBe(false));
  it("aktif + masih ada biaya belum ditagih → false", () => expect(isLunasBelumPulang(aktif, bill("Belum ditagih"))).toBe(false));
  it("aktif + koreksi tagihan → false", () => expect(isLunasBelumPulang(aktif, bill("Koreksi tagihan"))).toBe(false));
  it("gagal baca tagihan (Belum terbaca) → false, bukan Lunas", () => expect(isLunasBelumPulang(aktif, BILLING_UNREAD)).toBe(false));
  it("status tagihan tidak ada → false", () => expect(isLunasBelumPulang(aktif, undefined)).toBe(false));
  it("discharged_at string kosong dianggap belum pulang (sama dengan !discharged_at di halaman)", () => expect(isLunasBelumPulang({ discharged_at: "" }, bill("Lunas"))).toBe(true));
  it("huruf kecil/besar harus persis — tidak menebak", () => expect(isLunasBelumPulang(aktif, bill("lunas"))).toBe(false));
});

describe("wibDate — batas hari WIB", () => {
  it("23:59 WIB tetap hari itu", () => expect(wibDate("2026-11-06T16:59:00Z")).toBe("2026-11-06"));
  it("00:00 WIB pindah ke hari berikutnya", () => expect(wibDate("2026-11-06T17:00:00Z")).toBe("2026-11-07"));
  it("00:00 WIB tepat dan 06:59 UTC", () => expect(wibDate("2026-11-05T17:00:00Z")).toBe("2026-11-06"));
  it("awal hari UTC masih hari yang sama di WIB", () => expect(wibDate("2026-11-06T00:00:00Z")).toBe("2026-11-06"));
});

describe("daysBetween", () => {
  it("selisih kalender", () => expect(daysBetween("2026-11-03", "2026-11-06")).toBe(3));
  it("tanggal sama → 0", () => expect(daysBetween("2026-11-06", "2026-11-06")).toBe(0));
  it("lintas bulan", () => expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3));
});

describe("laporanHarian — laporan hari ini (WIB)", () => {
  const today = "2026-11-06";
  it("tanpa log → belum, tidak ada tanggal terakhir", () => {
    expect(laporanHarian([], today)).toEqual({ state: "belum", count: 0, lastDate: null, daysSince: null });
  });
  it("satu log hari ini → ada (1)", () => {
    expect(laporanHarian([log("r1", "2026-11-06")], today)).toEqual({ state: "ada", count: 1, lastDate: "2026-11-06", daysSince: 0 });
  });
  it("beberapa log hari ini → ada (n), log kemarin tidak dihitung", () => {
    const r = laporanHarian([log("r1", "2026-11-06"), log("r1", "2026-11-06"), log("r1", "2026-11-05"), log("r1", "2026-11-06")], today);
    expect(r.state).toBe("ada");
    expect(r.count).toBe(3);
  });
  it("hanya log kemarin → belum, 1 hari", () => {
    expect(laporanHarian([log("r1", "2026-11-05")], today)).toEqual({ state: "belum", count: 0, lastDate: "2026-11-05", daysSince: 1 });
  });
  it("log terakhir 3 hari lalu → belum, 3 hari; ambil yang terbaru dari banyak log", () => {
    const r = laporanHarian([log("r1", "2026-10-30"), log("r1", "2026-11-03"), log("r1", "2026-11-01")], today);
    expect(r).toEqual({ state: "belum", count: 0, lastDate: "2026-11-03", daysSince: 3 });
  });
  it("log_date bertipe timestamp dipotong ke tanggal", () => {
    expect(laporanHarian([log("r1", "2026-11-06T00:00:00")], today).state).toBe("ada");
  });
  it("log_date kosong memakai tanggal WIB dari created_at (23:59 WIB hari ini)", () => {
    expect(laporanHarian([log("r1", null, "2026-11-06T16:59:00Z")], today).state).toBe("ada");
  });
  it("log_date kosong dan created_at 00:00 WIB besok bukan hari ini", () => {
    expect(laporanHarian([log("r1", null, "2026-11-06T17:00:00Z")], today).state).toBe("belum");
  });
  it("log_date kosong dan created_at 00:00 WIB hari ini dihitung hari ini", () => {
    expect(laporanHarian([log("r1", null, "2026-11-05T17:00:00Z")], today).state).toBe("ada");
  });
  it("log bertanggal masa depan tidak dianggap laporan hari ini maupun terakhir", () => {
    expect(laporanHarian([log("r1", "2026-11-07")], today)).toEqual({ state: "belum", count: 0, lastDate: null, daysSince: null });
  });
});

describe("canSeeLaporanTertinggal — hanya OWNER/ADMIN", () => {
  it.each(["OWNER", "ADMIN"])("%s boleh", (r) => expect(canSeeLaporanTertinggal(r)).toBe(true));
  it.each(["DOCTOR", "KASIR", "FINANCE", "", null, undefined, "owner"])("%s tidak boleh", (r) => expect(canSeeLaporanTertinggal(r as string | null | undefined)).toBe(false));
});

describe("groupLogsByRecord + laporanTertinggal", () => {
  const today = "2026-11-06";
  const recs = [
    { id: "r1", label: "Bimo" }, { id: "r2", label: "Mimi" }, { id: "r3", label: "Coco" }, { id: "r4", label: "Dodo" },
  ];
  const logs = [log("r1", "2026-11-06"), log("r2", "2026-11-05"), log("r3", "2026-11-03"), log("r1", "2026-11-06")];

  it("mengelompokkan per rawat inap", () => {
    const g = groupLogsByRecord(logs);
    expect(g.get("r1")).toHaveLength(2);
    expect(g.get("r4")).toBeUndefined();
  });
  it("hanya pasien tanpa log hari ini yang tertinggal; urut paling lama dulu; belum pernah lapor di depan", () => {
    const out = laporanTertinggal(recs, groupLogsByRecord(logs), today);
    expect(out.map((o) => o.id)).toEqual(["r4", "r3", "r2"]);
    expect(out.find((o) => o.id === "r2")).toMatchObject({ label: "Mimi", daysSince: 1 });
    expect(out.find((o) => o.id === "r3")).toMatchObject({ daysSince: 3, lastDate: "2026-11-03" });
    expect(out.find((o) => o.id === "r4")).toMatchObject({ daysSince: null, lastDate: null });
  });
  it("semua sudah lapor → kosong", () => {
    expect(laporanTertinggal([recs[0]], groupLogsByRecord(logs), today)).toEqual([]);
  });
});

describe("readDailyLogsBatched — satu bacaan bertumpuk, bukan N+1", () => {
  function fakeDb(rowsByCall: DailyLogRow[][], opts: { error?: boolean } = {}) {
    const calls: { table: string; col: string; ids: string[] }[] = [];
    let n = 0;
    return {
      calls,
      db: {
        from(table: string) {
          const q = {
            select: () => q,
            in: (col: string, ids: string[]) => { calls.push({ table, col, ids }); return q; },
            order: () => q,
            range: () => q,
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(opts.error ? { data: null, error: { code: "42501" } } : { data: rowsByCall[n++] ?? [], error: null }).then(resolve),
          };
          return q;
        },
      },
    };
  }

  it("tidak memanggil database bila tidak ada pasien aktif", async () => {
    const f = fakeDb([]);
    const out = await readDailyLogsBatched(f.db as never, []);
    expect(out?.size).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  it("20 pasien → tepat satu bacaan inpatient_daily_logs memakai in(...)", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const f = fakeDb([[log("r0", "2026-11-06"), log("r5", "2026-11-05")]]);
    const out = await readDailyLogsBatched(f.db as never, ids);
    expect(f.calls).toEqual([{ table: "inpatient_daily_logs", col: "inpatient_record_id", ids }]);
    expect(out?.get("r0")).toHaveLength(1);
    expect(out?.get("r5")).toHaveLength(1);
  });
  it("gagal baca → null (tidak terbaca), bukan 'belum ada laporan'", async () => {
    const f = fakeDb([], { error: true });
    expect(await readDailyLogsBatched(f.db as never, ["r1"])).toBeNull();
  });
  it("halaman penuh dilanjutkan ke halaman berikutnya (tidak terpotong diam-diam)", async () => {
    const full = Array.from({ length: 500 }, (_, i) => log("r1", "2026-10-01", `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z`));
    const f = fakeDb([full, [log("r1", "2026-09-01")]]);
    const out = await readDailyLogsBatched(f.db as never, ["r1"]);
    expect(out?.get("r1")).toHaveLength(501);
    expect(f.calls).toHaveLength(2);
  });
});
