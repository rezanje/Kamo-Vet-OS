// Nomor antrian & estimasi tunggu (Addendum §4) — pure.

// [Huruf][3 digit] per cabang per hari; huruf dari poli (default A).
export function queueLetter(poli: string): string {
  const m: Record<string, string> = { "Poli Umum": "A", "Poli Bedah": "B", "Grooming": "G", "Vaksinasi": "V" };
  return m[poli] ?? "A";
}

export function nextQueueNumber(poli: string, existingToday: (string | null)[]): string {
  const letter = queueLetter(poli);
  const max = existingToday
    .filter((q): q is string => !!q && q.startsWith(letter))
    .reduce((a, q) => Math.max(a, parseInt(q.slice(1), 10) || 0), 0);
  return `${letter}${String(max + 1).padStart(3, "0")}`;
}

// ponytail: v1 hardcode 20 menit rata-rata periksa (spec: jangan over-engineer dgn prediksi).
export const AVG_EXAM_MINUTES = 20;
export function estimatedWaitMinutes(positionInQueue: number): number {
  return positionInQueue * AVG_EXAM_MINUTES;
}
