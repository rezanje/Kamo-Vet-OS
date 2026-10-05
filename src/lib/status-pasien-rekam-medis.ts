export type CatatanStatusRawatInap = {
  created_at: string;
  discharged_at: string | null;
  condition_status: string;
};

export function statusPasienRekamMedis(
  records: CatatanStatusRawatInap | CatatanStatusRawatInap[] | null,
  imported: boolean,
): { label: string; badge: "b" | "g" | "r" | "x" } {
  const list = records ? (Array.isArray(records) ? records : [records]) : [];
  const latest = list.reduce<CatatanStatusRawatInap | null>((current, record) =>
    !current || record.created_at > current.created_at ? record : current, null);
  if (!latest) return imported
    ? { label: "Status belum tercatat", badge: "x" }
    : { label: "Rawat jalan", badge: "x" };
  if (!latest.discharged_at) return { label: "Rawat inap", badge: "b" };
  if (latest.condition_status === "rip") return { label: "Meninggal", badge: "r" };
  return { label: "Sudah pulang", badge: "g" };
}
