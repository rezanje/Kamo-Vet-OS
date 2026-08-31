/* eslint-disable @typescript-eslint/no-explicit-any */
import { calculateOccupancy, countReferrals, followUpCompliance, serviceDurations } from "./operasional-klinik";

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
    supabase.from("bookings").select("branch_id,status,attendance_outcome,tanggal").in("branch_id", allowedIds).gte("tanggal", filters.from).lte("tanggal", filters.to),
    supabase.from("visits").select("branch_id,status,checked_in_at,service_started_at,service_finished_at,checked_out_at").in("branch_id", allowedIds).gte("created_at", start).lte("created_at", end),
    supabase.from("follow_ups").select("branch_id,status,tanggal,completed_at").in("branch_id", allowedIds).lte("tanggal", filters.to),
    supabase.from("visit_referrals").select("branch_id,direction,referred_at").in("branch_id", allowedIds).gte("referred_at", start).lte("referred_at", end),
    supabase.from("inpatient_records").select("branch_id,admitted_at,discharged_at").in("branch_id", allowedIds).lt("admitted_at", end),
    supabase.from("branch_capacity_periods").select("branch_id,capacity,valid_from,valid_until").in("branch_id", allowedIds).lte("valid_from", filters.to),
  ]);
  for (const result of [bookings, visits, followUps, referrals, admissions, capacities]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    from: filters.from,
    to: filters.to,
    branches: allowedIds.map((branchId) => {
      const branchBookings = (bookings.data ?? []).filter((row: any) => row.branch_id === branchId);
      const branchVisits = (visits.data ?? []).filter((row: any) => row.branch_id === branchId);
      const branchFollowUps = (followUps.data ?? []).filter((row: any) => row.branch_id === branchId);
      const branchReferrals = (referrals.data ?? []).filter((row: any) => row.branch_id === branchId);
      const branchAdmissions = (admissions.data ?? []).filter((row: any) => row.branch_id === branchId);
      const branchCapacities = (capacities.data ?? []).filter((row: any) => row.branch_id === branchId);
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
