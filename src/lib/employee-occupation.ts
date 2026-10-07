export const clinicalOccupations = ['Dokter', 'Paramedis', 'Groomer'] as const;

/** Occupation is the HR job label, independent of the login role. */
export function employeeOccupationInput(data: FormData): string | null {
  const selected = String(data.get('occupation') ?? '').trim();
  if (selected && selected !== 'other') {
    if (!clinicalOccupations.some(job => job === selected)) throw new Error('Jabatan tidak valid');
    return selected;
  }
  return String(data.get('jabatan') ?? '').trim() || null;
}
