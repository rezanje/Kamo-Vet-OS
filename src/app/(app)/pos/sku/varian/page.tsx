import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VariantFamilyForm } from "./VariantFamilyForm";

type Member = { item_id: string; label: string; sort_order: number; items: { code: string; name: string } | { code: string; name: string }[] | null };
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function VariantFamilyPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: items }, { data: categories }, { data: families }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("items").select("id,code,name").eq("is_active", true).neq("item_type", "Grup").order("code").limit(2000),
    supabase.from("item_categories").select("id,name").eq("is_active", true).order("name"),
    supabase.from("item_variant_families").select("id,name,category_id,item_variant_members(item_id,label,sort_order,items(code,name))").order("name"),
  ]);
  const boleh = profile?.role === "OWNER" || profile?.role === "ADMIN";
  return (
    <>
      <div style={{ marginBottom: 4 }}><Link href="/pos/sku" className="back-btn"><i className="ti ti-arrow-left" /> Barang &amp; Jasa</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#f3f0ff", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-packages" style={{ fontSize: 22, color: "#7c3aed" }} /></div>
        <div><div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>KELUARGA VARIAN</div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>Kelompok tampilan untuk beberapa SKU mandiri</div></div>
      </div>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-circle-check" /> {success}</div>}
      {!boleh ? <div className="p2ban"><i className="ti ti-lock" /> Hanya OWNER/ADMIN yang bisa mengubah keluarga varian.</div> : <VariantFamilyForm items={items ?? []} categories={categories ?? []} />}
      <section className="crm-sec">
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Keluarga tersimpan ({families?.length ?? 0})</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {(families ?? []).map((family) => {
            const members = [...((family.item_variant_members ?? []) as Member[])].sort((a, b) => a.sort_order - b.sort_order);
            return <div key={family.id} style={{ border: "1px solid var(--bd)", borderRadius: 9, padding: "9px 11px" }}>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{family.name}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {members.map((member) => { const item = one(member.items); return <span key={member.item_id} className="badge b">{member.label} · {item?.code ?? member.item_id}</span>; })}
              </div>
            </div>;
          })}
          {!families?.length && <div style={{ fontSize: 11, color: "var(--tm)" }}>Belum ada keluarga varian.</div>}
        </div>
      </section>
    </>
  );
}
