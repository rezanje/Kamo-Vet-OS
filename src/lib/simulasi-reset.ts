export const RESET_SIMULASI_TOTAL_PHRASE = "RESET SIMULASI TOTAL";

type ResetSimulasiInput = {
  role: string | null | undefined;
  understoodImpact: boolean;
  confirmation: string;
};

/** Guard tampilan. Database mengecek ulang agar tombol tidak bisa disiasati. */
export function bolehResetSimulasi(input: ResetSimulasiInput): boolean {
  return input.role === "OWNER"
    && input.understoodImpact
    && input.confirmation.trim() === RESET_SIMULASI_TOTAL_PHRASE;
}
