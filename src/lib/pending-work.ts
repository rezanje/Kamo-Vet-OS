// Persistent dashboard alerts backed by the same actionable queues used by each module.
// A failed read is shown as unknown; it must not look like an empty queue.
// Each alert is shown only when the role may open its queue under Akses Grup
// (same rule as the middleware), so the dashboard never links to a blocked page.
// If Akses Grup cannot be read, the role's default modules decide the links.
import { bolehBukaPath } from "@/lib/akses";
import { CORRECTION_QUEUE_PATH } from "@/lib/purchase-correction-requests";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
export type PendingWork = { label: string; href: string; count: number | null; hasMore?: boolean };

export async function loadPendingWork(db: AnyClient, role: string | null): Promise<PendingWork[]> {
  if (!role || !["OWNER", "ADMIN", "FINANCE"].includes(role)) return [];
  let rules: { role: string; module_id: string }[] = [];
  const canOpen = (href: string) => bolehBukaPath(role, href.split("?")[0], rules);
  try {
  const { data, error: rulesError } = await db.from("role_modules").select("role, module_id").eq("role", role);
  if (rulesError || !Array.isArray(data)) throw new Error("Akses Grup belum dapat dibaca");
  rules = data;
  const requests: Promise<PendingWork>[] = [];

  if (canOpen("/pengaturan/penyetuju")) {
  const approvalQuery = db.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "menunggu");
  if (role !== "OWNER") approvalQuery.eq("penyetuju_role", role);
  requests.push(Promise.resolve(approvalQuery).then(
    (result: { count: number | null; error: unknown }) => ({
      label: "Pengajuan menunggu persetujuan", href: "/pengaturan/penyetuju",
      count: result.error || typeof result.count !== "number" ? null : result.count,
    }), () => ({ label: "Pengajuan menunggu persetujuan", href: "/pengaturan/penyetuju", count: null }),
  ));
  }

  if ((role === "OWNER" || role === "ADMIN") && canOpen("/pembelian/perintah-bayar")) {
    requests.push(Promise.resolve(db.from("payment_orders").select("id", { count: "exact", head: true }).eq("status", "draft"))
      .then((result: { count: number | null; error: unknown }) => ({
        label: "Perintah bayar menunggu persetujuan", href: "/pembelian/perintah-bayar?pending=1",
        count: result.error || typeof result.count !== "number" ? null : result.count,
      }), () => ({ label: "Perintah bayar menunggu persetujuan", href: "/pembelian/perintah-bayar?pending=1", count: null })));
  }

  // A02/P01: only Super Admin processes purchase correction requests; requesters track
  // their own request on the source document instead of a dashboard alert.
  if (role === "OWNER" && canOpen(CORRECTION_QUEUE_PATH)) {
    requests.push(Promise.resolve(db.from("purchase_correction_requests").select("id", { count: "exact", head: true }).eq("status", "pending"))
      .then((result: { count: number | null; error: unknown }) => ({
        label: "Permintaan koreksi pembelian", href: CORRECTION_QUEUE_PATH,
        count: result.error || typeof result.count !== "number" ? null : result.count,
      }), () => ({ label: "Permintaan koreksi pembelian", href: CORRECTION_QUEUE_PATH, count: null })));
  }

  if (canOpen("/kas-bank/refund")) requests.push(Promise.all(["pending", "diproses"].map(status => Promise.resolve().then(() => db.rpc("get_sales_refund_requests", {
    p_sale_id: null, p_office: true, p_status: status, p_offset: 0,
  })))).then((results: { data: unknown; error: unknown }[]) => {
    const valid = results.every(result => !result.error && Array.isArray(result.data));
    const firstPageCount = valid ? results.reduce((count, result) => count + (result.data as unknown[]).length, 0) : null;
    return { label: "Refund transfer belum selesai", href: "/kas-bank/refund",
      count: firstPageCount, hasMore: valid && results.some(result => (result.data as unknown[]).length >= 100) };
  }, () => ({ label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: null })));

  return (await Promise.all(requests)).filter(item => item.count === null || item.count > 0);
  } catch {
    return [
      { label: "Pengajuan menunggu persetujuan", href: "/pengaturan/penyetuju", count: null },
      ...(["OWNER", "ADMIN"].includes(role) ? [{ label: "Perintah bayar menunggu persetujuan", href: "/pembelian/perintah-bayar?pending=1", count: null }] : []),
      ...(role === "OWNER" ? [{ label: "Permintaan koreksi pembelian", href: CORRECTION_QUEUE_PATH, count: null }] : []),
      { label: "Refund transfer belum selesai", href: "/kas-bank/refund", count: null },
    ].filter(item => canOpen(item.href));
  }
}
