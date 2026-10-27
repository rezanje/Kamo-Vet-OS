import type { ServiceStaff } from "@/lib/service-performers";

/** A line can be assigned in the clinical cart or left for the cashier. */
export function ClinicLineSellerField({ name, value, staff, onChange }: {
  name: string; value?: string | null; staff: ServiceStaff[]; onChange: (id: string | null) => void;
}) {
  return <label style={{display:'block',fontSize:10,marginTop:4}}>Penjual SKU
    <select className="fi" aria-label={`Penjual ${name}`} value={value ?? ''}
      onChange={event => onChange(event.target.value || null)} style={{height:25,fontSize:10}}>
      <option value="">Belum dipilih — kasir dapat menentukan</option>
      {staff.map(person => <option key={person.id} value={person.id}>{person.nama}</option>)}
    </select>
  </label>;
}
