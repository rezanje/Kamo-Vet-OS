"use client";
import { useState } from 'react';
import { clinicalOccupations } from '@/lib/employee-occupation';

export function EmployeeOccupationField({ value }: { value?: string | null }) {
  const [selection, setSelection] = useState<string>(clinicalOccupations.some(job => job === value) ? value! : 'other');
  return <div>
    <label className="flab" htmlFor="occupation">Jabatan</label>
    <select id="occupation" name="occupation" className="fi" value={selection} onChange={event => setSelection(event.target.value)}>
      <option value="other">Jabatan lainnya</option>
      {clinicalOccupations.map(job => <option key={job} value={job}>{job}</option>)}
    </select>
    {selection === 'other' && <input className="fi" name="jabatan" aria-label="Jabatan lainnya" defaultValue={value ?? ''} placeholder="Jabatan sesuai data HRIS" />}
    <small style={{ color: 'var(--tm)' }}>Jabatan klinis menentukan pilihan petugas; hak akses akun diatur terpisah.</small>
  </div>;
}
