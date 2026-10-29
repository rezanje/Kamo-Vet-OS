import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ owners: [] as { id: string; name: string; phone: string }[], pets: [] as { id: string; customer_id: string; name: string }[], existing: [] as string[], calls: [] as Record<string, unknown>[], failure: '', rpcReject: '' }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from(table: string) {
    let from = 0, to = Infinity;
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, maybeSingle: () => q,
      range: (a: number, b: number) => { from = a; to = b; return q; },
      then(resolve: (r: unknown) => unknown) {
        const rows = table === 'customers' ? s.owners : table === 'pets' ? s.pets : s.existing.map((legacy_source_key, index) => ({ id: `visit-${index}`, legacy_source_key }));
        return Promise.resolve({ error: s.failure === table ? { message: 'Synthetic identity read failure' } : null, data: table === 'profiles' ? { role: 'OWNER' } : rows.slice(from, to + 1), count: rows.length }).then(resolve);
      },
    }; return q;
  },
  rpc: async (_name: string, args: Record<string, unknown>) => { s.calls.push(args); if (s.rpcReject) return { error: { message: s.rpcReject } }; s.existing.push(String(args.p_source_key)); return { error: null }; },
}) }));
import { simpanBatchImporRekamMedis } from '@/app/(app)/klinik/rekam-medis/impor/actions';
import type { RekamMedisImporRow } from '@/lib/impor-rekam-medis';
const row: RekamMedisImporRow = { source_key: 'fictional-new', source_file: 'Fictional.xlsx', source_sheet: '20261023', record_no: null, record_date: '2026-10-23', owner_name: 'Dr Mira', phone: '080000000001', patient_name: 'Fictional  cat', address: null, species: null, breed: null, gender: null, dob: null, doctor: null, note: null, anamnesis: 'New fictional history', clinical_findings: null, diagnosis: null, therapy: null, warning: [] };
beforeEach(() => { s.owners = [{ id: 'owner', name: 'Dr. Mira', phone: '0800-0000-0001' }]; s.pets = [{ id: 'pet', customer_id: 'owner', name: 'Fictional cat' }]; s.existing = ['fictional-old']; s.calls = []; s.failure = ''; s.rpcReject = ''; });
it('passes the unique normalized preview identity explicitly so delta adds history to the same owner and pet', async () => {
  expect((await simpanBatchImporRekamMedis([row], [], true)).ok).toBe(true);
  expect(s.calls[0]).toMatchObject({ p_customer_id: 'owner', p_pet_id: 'pet', p_anamnesis: 'New fictional history' });
});
it('retries an existing source without writing another visit', async () => {
  await simpanBatchImporRekamMedis([row], [], true); const response = await simpanBatchImporRekamMedis([row], [], true);
  expect(response).toMatchObject({ ok: true, tersimpan: 0, sudah_ada: 1 });
  // K1b: the retry is sent once more so the database can prove the content is identical;
  // it carries no identity decision because nothing new will be created.
  expect(s.calls).toHaveLength(2); expect(s.calls[1]).toMatchObject({ p_source_key: row.source_key, p_customer_id: null, p_pet_id: null });
  expect(s.existing.filter(key => key === row.source_key)).toHaveLength(2); expect(s.existing).toContain('fictional-old');
});
it('stops instead of counting an unproven existing source as already imported', async () => {
  s.existing.push(row.source_key);
  s.rpcReject = 'Jejak sumber bentrok: kartu ini memakai jejak sumber yang sama dengan riwayat tersimpan, tetapi isinya berbeda.';
  const response = await simpanBatchImporRekamMedis([row], [], true);
  expect(response).toMatchObject({ ok: false, tersimpan: 0, sudah_ada: 0 });
  expect(response.message).toContain('Jejak sumber bentrok');
  expect(response.message).toContain(row.source_file);
  expect(s.calls).toHaveLength(1);
});
it('requires current clarification for the same phone with a different owner name, even if a client omits it', async () => {
  s.owners[0].name = 'Other fictional owner';
  expect((await simpanBatchImporRekamMedis([row], [], true)).ok).toBe(false); expect(s.calls).toHaveLength(0);
});
it('does not pick an arbitrary pet when the owner has two pets with the same normalized name', async () => {
  s.pets.push({ ...s.pets[0], id: 'pet-2' });
  expect((await simpanBatchImporRekamMedis([row], [], true)).ok).toBe(false); expect(s.calls).toHaveLength(0);
});
it('preserves an explicit currently valid pet decision for an ambiguous identity', async () => {
  s.pets.push({ ...s.pets[0], id: 'pet-2' });
  const response = await simpanBatchImporRekamMedis([row], [{ source_key: row.source_key, decision: { customer_id: 'owner', pet_id: 'pet-2' } }], true);
  expect(response.ok).toBe(true); expect(s.calls[0]).toMatchObject({ p_customer_id: 'owner', p_pet_id: 'pet-2' });
});
it('fails before writing if authoritative identity metadata cannot be loaded', async () => {
  s.failure = 'pets'; expect((await simpanBatchImporRekamMedis([row], [], true)).ok).toBe(false); expect(s.calls).toHaveLength(0);
});
it('preserves an explicit skip for an otherwise exact identity', async () => {
  const response = await simpanBatchImporRekamMedis([row], [{ source_key: row.source_key, decision: 'skip' }], true);
  expect(response).toMatchObject({ ok: true, tersimpan: 0, dilewati: 1 }); expect(s.calls).toHaveLength(0);
});
it('recovers an already imported source before asking for a changed identity decision', async () => {
  s.existing.push(row.source_key); s.owners[0].name = 'Changed fictional name';
  const response = await simpanBatchImporRekamMedis([row], [], true);
  // No clarification is demanded for an already recorded source; the database proves the
  // content is identical without any identity decision (K1b).
  expect(response).toMatchObject({ ok: true, tersimpan: 0, sudah_ada: 1 });
  expect(s.calls).toHaveLength(1); expect(s.calls[0]).toMatchObject({ p_customer_id: null, p_pet_id: null });
});
it('carries the same explicit IDs through the original file-confirmation entry point', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const { konfirmasiImporRekamMedis } = await import('@/app/(app)/klinik/rekam-medis/impor/actions');
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('23102026');
  sheet.getCell('A1').value = 'KARTU MEDIS PASIEN'; sheet.getCell('A2').value = 'Nama pasien'; sheet.getCell('B2').value = 'Fictional cat';
  sheet.getCell('A3').value = 'Nama pemilik'; sheet.getCell('B3').value = 'Dr Mira'; sheet.getCell('A4').value = 'No telepon'; sheet.getCell('B4').value = '080000000001';
  sheet.getCell('A5').value = 'Tanggal'; sheet.getCell('B5').value = '23/10/2026'; sheet.getCell('A6').value = 'Diagnosa'; sheet.getCell('B6').value = 'New fictional diagnosis';
  const bytes = await workbook.xlsx.writeBuffer(); const form = new FormData();
  form.append('files', new File([new Uint8Array(bytes).buffer], 'Fictional cat.xlsx'));
  form.append('paths', 'Dr Mira - 080000000001/Fictional cat.xlsx'); form.set('approved', 'true');
  const response = await konfirmasiImporRekamMedis(form);
  expect(response, response.message).toMatchObject({ ok: true, phase: 'done' });
  expect(s.calls[0]).toMatchObject({ p_customer_id: 'owner', p_pet_id: 'pet' });
});
it('finds the exact identity beyond the first metadata API page', async () => {
  s.owners.unshift(...Array.from({ length: 1001 }, (_, i) => ({ id: `other-${i}`, name: `Fictional unrelated ${i}`, phone: `070${i}` })));
  expect((await simpanBatchImporRekamMedis([row], [], true)).ok).toBe(true);
  expect(s.calls[0]).toMatchObject({ p_customer_id: 'owner', p_pet_id: 'pet' });
});
