// Nomor antrian & estimasi tunggu (Addendum §4) — pure.

// [Huruf][3 digit] per cabang per hari; huruf dari poli (default A).
export function queueLetter(poli: string): string {
  const m: Record<string, string> = { "Poli Umum": "A", "Poli Bedah": "B", "Grooming": "G", "Vaksinasi": "V" };
  return m[poli] ?? "A";
}

/**
 * Awalan cabang pada nomor antrian (permintaan Pak Andri, meeting 14 Agustus).
 *
 * Nomornya sudah unik per cabang per hari, tapi begitu dipanggil lewat radio atau
 * dibaca di grup lintas cabang, "A001" milik siapa jadi tidak jelas. Kode cabang
 * dipakai apa adanya, tanpa awalan VET_ yang tidak dibaca siapa pun.
 */
export function queuePrefix(branchCode: string | null | undefined): string {
  const kode = (branchCode ?? "").trim().toUpperCase().replace(/^VET[_-]?/, "");
  return kode.slice(0, 5);
}

/**
 * Nomor antrian berikutnya: <KODE CABANG>-<HURUF POLI><3 digit>, mis. CMGG-A001.
 * Cabang tanpa kode tetap dapat pola lama (A001) — data lama tidak boleh pecah.
 */
export function nextQueueNumber(
  poli: string,
  existingToday: (string | null)[],
  branchCode?: string | null,
): string {
  const letter = queueLetter(poli);
  const prefix = queuePrefix(branchCode);
  const awalan = prefix ? `${prefix}-${letter}` : letter;

  // Nomor lama (tanpa awalan cabang) ikut dihitung supaya urutannya tidak mengulang
  // dari 001 saat awalan mulai dipakai di tengah hari.
  const angka = (q: string): number => {
    const cocok = q.match(/(\d{1,4})$/);
    if (!cocok) return 0;
    const huruf = q.slice(0, q.length - cocok[1].length);
    return huruf.endsWith(letter) ? Number(cocok[1]) : 0;
  };

  const max = existingToday
    .filter((q): q is string => !!q)
    .reduce((a, q) => Math.max(a, angka(q)), 0);
  return `${awalan}${String(max + 1).padStart(3, "0")}`;
}

// ponytail: v1 hardcode 20 menit rata-rata periksa (spec: jangan over-engineer dgn prediksi).
export const AVG_EXAM_MINUTES = 20;
export function estimatedWaitMinutes(positionInQueue: number): number {
  return positionInQueue * AVG_EXAM_MINUTES;
}
