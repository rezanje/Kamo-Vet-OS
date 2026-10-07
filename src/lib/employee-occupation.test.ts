import { expect, it } from 'vitest';
import { employeeOccupationInput } from './employee-occupation';
import { clinicalRoles, staffForService, performersForService } from './clinical-staff';

it('stores explicitly selected occupations and preserves other existing HR labels', () => {
  const data = new FormData(); data.set('occupation', 'Paramedis'); data.set('jabatan', 'PCA');
  expect(employeeOccupationInput(data)).toBe('Paramedis');
  data.set('occupation', 'other'); expect(employeeOccupationInput(data)).toBe('PCA');
  data.delete('occupation'); expect(employeeOccupationInput(data)).toBe('PCA');
  data.set('occupation', 'DOCTOR'); expect(() => employeeOccupationInput(data)).toThrow('Jabatan');
});
it('keeps paramedics out of doctor assignments and recognizes grooming without interpreting PCA', () => {
  const staff = [{ jabatan: 'Dokter' }, { jabatan: 'Paramedis' }, { jabatan: 'Groomer' }, { jabatan: 'PCA' }];
  expect(clinicalRoles('PCA')).toEqual([]);
  expect(staffForService(staff, 'Poli Umum')).toEqual([staff[0]]);
  expect(performersForService(staff, 'Poli Umum')).toEqual([staff[0], staff[1]]);
  expect(staffForService(staff, 'Grooming')).toEqual([staff[2]]);
});
