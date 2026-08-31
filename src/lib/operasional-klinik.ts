export type BookingOutcome = "pending" | "hadir" | "no_show";
export type VisitSource = "booking" | "walk_in";

export type Timeline = {
  checkedInAt: string | null;
  serviceStartedAt: string | null;
  serviceFinishedAt: string | null;
  checkedOutAt: string | null;
};

export type BookingForOutcome = {
  status: string;
  outcome: BookingOutcome;
  scheduledAt: string;
  visitId: string | null;
};

export function bolehNoShow(booking: BookingForOutcome, now = new Date()) {
  return booking.status === "dikonfirmasi"
    && booking.outcome === "pending"
    && !booking.visitId
    && new Date(booking.scheduledAt).getTime() < now.getTime();
}

export function validateServiceTimeline(timeline: Timeline): string | null {
  const values = [timeline.checkedInAt, timeline.serviceStartedAt, timeline.serviceFinishedAt, timeline.checkedOutAt]
    .map((value) => value ? new Date(value).getTime() : null);
  const labels = ["check-in", "mulai layanan", "selesai layanan", "check-out"];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== null && values[index - 1] !== null && values[index]! < values[index - 1]!) {
      return `${labels[index]} tidak boleh lebih awal dari ${labels[index - 1]}`;
    }
  }
  return null;
}

function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const difference = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  return difference >= 0 ? difference : null;
}

export function serviceDurations(timeline: Timeline) {
  return {
    waitMinutes: minutesBetween(timeline.checkedInAt, timeline.serviceStartedAt),
    serviceMinutes: minutesBetween(timeline.serviceStartedAt, timeline.serviceFinishedAt),
  };
}

export type FollowUpMetricRow = { status: string; dueDate: string; completedAt: string | null };

function jakartaDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function endOfJakartaDate(date: string) {
  return new Date(`${date}T16:59:59.999Z`).getTime();
}

export function followUpCompliance(rows: FollowUpMetricRow[], now = new Date()) {
  const today = jakartaDate(now);
  const dueRows = rows.filter((row) => row.status !== "Batal" && row.dueDate <= today);
  const completed = dueRows.filter((row) => row.status === "Selesai"
    && row.completedAt != null
    && new Date(row.completedAt).getTime() <= endOfJakartaDate(row.dueDate)).length;
  return { due: dueRows.length, completed, rate: dueRows.length ? completed / dueRows.length : null };
}

export type CapacityPeriod = { capacity: number; validFrom: string; validUntil: string | null };
export type AdmissionPeriod = { admittedAt: string; dischargedAt: string | null };
export type OccupancyInput = {
  from: string;
  to: string;
  admissions: AdmissionPeriod[];
  capacities: CapacityPeriod[];
};

function addDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function jakartaDayStart(date: string) {
  return new Date(`${date}T00:00:00+07:00`).getTime();
}

export function calculateOccupancy(input: OccupancyInput) {
  if (input.from > input.to) return { status: "missing" as const };
  let occupiedBedDays = 0;
  let availableBedDays = 0;
  for (let date = input.from; date <= input.to; date = addDate(date, 1)) {
    const capacity = input.capacities.find((period) => period.validFrom <= date
      && (period.validUntil == null || period.validUntil >= date));
    if (!capacity || !Number.isFinite(capacity.capacity) || capacity.capacity <= 0) return { status: "missing" as const };
    const dayStart = jakartaDayStart(date);
    const dayEnd = jakartaDayStart(addDate(date, 1));
    availableBedDays += capacity.capacity;
    occupiedBedDays += input.admissions.filter((admission) => {
      const admittedAt = new Date(admission.admittedAt).getTime();
      const dischargedAt = admission.dischargedAt ? new Date(admission.dischargedAt).getTime() : Number.POSITIVE_INFINITY;
      return admittedAt < dayEnd && dischargedAt > dayStart;
    }).length;
  }
  return {
    status: "ok" as const,
    occupiedBedDays,
    availableBedDays,
    rate: availableBedDays ? occupiedBedDays / availableBedDays : null,
  };
}

export type ReferralDirection = "masuk" | "keluar";

export function countReferrals(rows: { direction: ReferralDirection }[]) {
  const masuk = rows.filter((row) => row.direction === "masuk").length;
  const keluar = rows.filter((row) => row.direction === "keluar").length;
  return { masuk, keluar, total: masuk + keluar };
}

export function isEligibleProvider(provider: { isActive: boolean; branchId: string }, branchId: string) {
  return provider.isActive && provider.branchId === branchId;
}
