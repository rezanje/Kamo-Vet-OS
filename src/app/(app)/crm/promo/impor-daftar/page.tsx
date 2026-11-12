import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { PromoMasterWorkspace } from "./PromoMasterWorkspace";

export default async function PromoMasterImportPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: me } = await db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle();
  const allowed = !!user && !!me?.is_active && ["OWNER", "ADMIN"].includes(me.role);
  return <>
    <Link href="/crm/promo" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Promo</Link>
    <div className="crm-sec" style={{ marginTop: 12 }}>
      <SecHeader num="01" title="IMPOR DAFTAR PROMO (EXCEL)"
        desc="Satu berkas boleh memuat beberapa promo diskon; tiap promo boleh memuat banyak barang. Nama yang sudah ada diperbarui, lengkap dengan preview perubahannya." />
      {allowed ? <PromoMasterWorkspace /> : <p>Hanya Owner/Admin aktif yang boleh mengunggah daftar promo.</p>}
    </div>
  </>;
}
