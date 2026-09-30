import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SecHeader } from "@/components/SecHeader";

export default async function RincianKaryawanPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await bolehKelolaMaster()) redirect("/hris/karyawan");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: employee }, { data: detail }] = await Promise.all([
    supabase.from("employees").select("id, nama, nik, jabatan, status").eq("id", id).maybeSingle(),
    supabase.from("employee_import_details").select("fields, imported_at").eq("employee_id", id).maybeSingle(),
  ]);
  if (!employee) notFound();
  const fields = detail?.fields && typeof detail.fields === "object" && !Array.isArray(detail.fields)
    ? detail.fields as Record<string, string>
    : {};

  return (
    <>
      <Link href="/hris/karyawan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Karyawan</Link>
      <div className="crm-sec" style={{ marginTop: 12 }}>
        <SecHeader num="01" title="RINCIAN KARYAWAN" desc={`${employee.nama} · ${employee.nik ?? "Tanpa ID"}`} />
        {!detail ? (
          <p>Karyawan ini belum memiliki rincian dari unggahan Excel.</p>
        ) : (
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
            {Object.entries(fields).map(([label, value]) => (
              <div key={label}>
                <dt style={{ color: "var(--tm)", fontSize: 11 }}>{label}</dt>
                <dd style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </>
  );
}
