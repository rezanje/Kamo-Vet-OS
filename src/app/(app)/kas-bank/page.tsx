import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TileGrid } from "@/components/ModuleHome";
import { REFUND_QUEUES } from "@/lib/pending-work";

// Halaman depan Kas & Bank sengaja tidak menampilkan saldo rekening (permintaan klinik, 12 Nov):
// layar ini terlihat banyak orang. Saldo tetap ada di submenu Rekening dan laporan keuangan.
export default async function KasBankPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile, error: profileError } = user
    ? await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle()
    : { data: null, error: null };
  const canViewRefund = !profileError && profile?.is_active && ["OWNER", "ADMIN", "FINANCE"].includes(profile.role);
  // Petshop dan klinik (J03) berbagi antrean refund transfer yang sama.
  const pendingResults = canViewRefund
    ? await Promise.all(REFUND_QUEUES.map(queue =>
      supabase.rpc(queue.rpc, { [queue.source]: null, p_office: true, p_status: "pending", p_offset: 0 })))
    : [];
  const hasPendingRefund = pendingResults.some(result => !result.error && Array.isArray(result.data) && result.data.length > 0);

  return (
    <>
      <div className="pg-hd">Kas &amp; Bank</div>
      <div className="pg-sub">Kas masuk, kas keluar, transfer, dan rekening</div>

      {canViewRefund && <p><Link className="btn-def" href="/kas-bank/refund">Antrean refund transfer</Link>{hasPendingRefund && <span role="status" style={{ marginLeft: 10 }}>Ada refund transfer menunggu</span>}</p>}
      <TileGrid moduleId="kas-bank" />
    </>
  );
}
