/* eslint-disable @typescript-eslint/no-explicit-any */
import { calculateOccupancy, countReferrals, followUpCompliance, serviceDurations } from "./operasional-klinik";
import { completeReportQuery } from "./report-query";

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type OperationalClinicFilters = { from: string; to: string; branchIds: string[] };

export type OperationalClinicDto = {
  from: string;
  to: string;
  branches: {
    branchId: string;
    bookings: { total: number; hadir: number; noShow: number; pending: number };
    visits: { total: number; selesai: number; avgWaitMinutes: number | null; avgServiceMinutes: number | null };
    followUps: { due: number; completed: number; rate: number | null };
    occupancy: ReturnType<typeof calculateOccupancy>;
    referrals: ReturnType<typeof countReferrals>;
  }[];
};

function requireDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Rentang tanggal tidak valid");
}

// Clinic rows are read page by page with an exact count (completeReportQuery). A plain
// select stops silently at PostgREST's max-rows (1000 on Supabase): a month across all
// branches would under-count, and so would follow_ups and inpatient_records, which have
// no lower date bound and grow with history. An incomplete or changing read throws, so
// the dashboard shows an error block instead of a smaller number. A failed page keeps its
// PostgREST code, so a missing table/column still shows as "missing" on the dashboard.
// Every query passed here must select `id` and ask for `{ count: "exact" }`.
async function readAll<T>(query: any): Promise<T[]> {
  return (await completeReportQuery<T>(query)).data;
}

export async function collectOperationalClinic(supabase: SupabaseLike, filters: OperationalClinicFilters): Promise<OperationalClinicDto> {
  requireDate(filters.from);
  requireDate(filters.to);
  if (filters.from > filters.to || !filters.branchIds.length) return { from: filters.from, to: filters.to, branches: [] };
  const branchIds = [...new Set(filters.branchIds.filter(Boolean))];
  const access = await Promise.all(branchIds.map(async (branchId) => {
    const result = await supabase.rpc("user_can_access_branch", { b: branchId });
    if (result.error) throw new Error(result.error.message);
    return { branchId, allowed: result.data === true };
  }));
  const allowedIds = access.filter((row) => row.allowed).map((row) => row.branchId);
  if (allowedIds.length !== branchIds.length) throw new Error("Ada cabang yang tidak dapat diakses");

  const start = `${filters.from}T00:00:00+07:00`;
  const end = `${filters.to}T23:59:59.999+07:00`;
  const [bookings, visits, followUps, referrals, admissions, capacities] = await Promise.all([
    readAll<any>(supabase.from("bookings").select("id,branch_id,status,attendance_outcome,tanggal", { count: "exact" }).in("branch_id", allowedIds).gte("tanggal", filters.from).lte("tanggal", filters.to)),
    readAll<any>(supabase.from("visits").select("id,branch_id,status,checked_in_at,service_started_at,service_finished_at,checked_out_at", { count: "exact" }).in("branch_id", allowedIds).gte("created_at", start).lte("created_at", end)),
    readAll<any>(supabase.from("follow_ups").select("id,branch_id,status,tanggal,completed_at", { count: "exact" }).in("branch_id", allowedIds).lte("tanggal", filters.to)),
    readAll<any>(supabase.from("visit_referrals").select("id,branch_id,direction,referred_at", { count: "exact" }).in("branch_id", allowedIds).gte("referred_at", start).lte("referred_at", end)),
    readAll<any>(supabase.from("inpatient_records").select("id,branch_id,admitted_at,discharged_at", { count: "exact" }).in("branch_id", allowedIds).lt("admitted_at", end)),
    readAll<any>(supabase.from("branch_capacity_periods").select("id,branch_id,capacity,valid_from,valid_until", { count: "exact" }).in("branch_id", allowedIds).lte("valid_from", filters.to)),
  ]);

  return {
    from: filters.from,
    to: filters.to,
    branches: allowedIds.map((branchId) => {
      const branchBookings = bookings.filter((row: any) => row.branch_id === branchId);
      const branchVisits = visits.filter((row: any) => row.branch_id === branchId);
      const branchFollowUps = followUps.filter((row: any) => row.branch_id === branchId);
      const branchReferrals = referrals.filter((row: any) => row.branch_id === branchId);
      const branchAdmissions = admissions.filter((row: any) => row.branch_id === branchId);
      const branchCapacities = capacities.filter((row: any) => row.branch_id === branchId);
      const durations = branchVisits.map((row: any) => serviceDurations({
        checkedInAt: row.checked_in_at ?? null,
        serviceStartedAt: row.service_started_at ?? null,
        serviceFinishedAt: row.service_finished_at ?? null,
        checkedOutAt: row.checked_out_at ?? null,
      }));
      const waits = durations.map((duration: ReturnType<typeof serviceDurations>) => duration.waitMinutes).filter((value: number | null): value is number => value != null);
      const services = durations.map((duration: ReturnType<typeof serviceDurations>) => duration.serviceMinutes).filter((value: number | null): value is number => value != null);
      const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return {
        branchId,
        bookings: {
          total: branchBookings.length,
          hadir: branchBookings.filter((row: any) => row.attendance_outcome === "hadir").length,
          noShow: branchBookings.filter((row: any) => row.attendance_outcome === "no_show").length,
          pending: branchBookings.filter((row: any) => (row.attendance_outcome ?? "pending") === "pending").length,
        },
        visits: {
          total: branchVisits.length,
          selesai: branchVisits.filter((row: any) => row.status === "Selesai").length,
          avgWaitMinutes: average(waits),
          avgServiceMinutes: average(services),
        },
        followUps: followUpCompliance(branchFollowUps.map((row: any) => ({ status: row.status, dueDate: row.tanggal, completedAt: row.completed_at })), new Date(`${filters.to}T23:59:59+07:00`)),
        occupancy: calculateOccupancy({
          from: filters.from,
          to: filters.to,
          admissions: branchAdmissions.map((row: any) => ({ admittedAt: row.admitted_at, dischargedAt: row.discharged_at })),
          capacities: branchCapacities.map((row: any) => ({ capacity: Number(row.capacity), validFrom: row.valid_from, validUntil: row.valid_until })),
        }),
        referrals: countReferrals(branchReferrals.map((row: any) => ({ direction: row.direction }))),
      };
    }),
  };
}
