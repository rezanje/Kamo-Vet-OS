// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DpAdmissionFields } from '@/app/(app)/klinik/pembayaran/[visitId]/DpAdmissionFields';
vi.stubGlobal('React',React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
it('restores explicit inpatient decision through the existing draft field event without changing payment snapshot keys',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 function Form(){const [selected,setSelected]=useState(false);return <form><DpAdmissionFields selected={selected} onChange={setSelected}/><button disabled={selected}>Bayar & Selesai</button></form>}
 await act(async()=>root.render(<Form/>));
 const form=host.querySelector('form')!;const decision=host.querySelector<HTMLSelectElement>('[name="admit_after_dp"]')!;
 expect(new FormData(form).get('admit_after_dp')).toBe('0');expect(new FormData(form).has('treatment_plan')).toBe(false);
 // Same DOM restoration protocol executed by useClinicDraft after a reload.
 await act(async()=>{decision.value='1';decision.dispatchEvent(new Event('vetos:numeric-sync'));});
 expect(new FormData(form).get('admit_after_dp')).toBe('1');expect(new FormData(form).has('treatment_plan')).toBe(true);
 expect(host.querySelector('button')!.disabled).toBe(true);expect(host.querySelector<HTMLInputElement>('[name="treatment_plan"]')!.required).toBe(true);
 await act(async()=>{decision.value='0';decision.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(new FormData(form).has('treatment_plan')).toBe(false);expect(host.querySelector('button')!.disabled).toBe(false);
 await act(async()=>root.unmount());host.remove();
});
