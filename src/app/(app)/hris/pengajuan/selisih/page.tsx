import Link from "next/link";
import { assertRole } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { prosesSelisih } from "./actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const db = await assertRole("/hris/pengajuan", "selisih kas", [
    "OWNER",
    "ADMIN",
  ]);
  const sp = await searchParams;
  const { data, error } = await db.rpc("hris_pending_shift_shortages");
  const rows = (data ?? []) as {
    id: string;
    closed_at: string;
    amount: number;
    name: string;
  }[];
  return (
    <div className="crm-sec">
      <Link href="/hris/pengajuan">Kembali ke pengajuan</Link>
      <h2>Selisih kas tertunda</h2>
      <p>
        Shift sudah ditutup, tetapi piutang kasir dan jurnal selisih belum
        tersimpan. Periksa selisih sebelum memproses ulang.
      </p>
      {(sp.error || error) && (
        <p role="alert">
          {sp.error ||
            "Daftar gagal dimuat. Muat ulang; daftar kosong belum dapat dipastikan."}
        </p>
      )}
      {sp.success && <p>Piutang dan jurnal tersimpan bersama.</p>}
      {!error && !rows.length && <p>Tidak ada selisih kas tertunda.</p>}
      {rows.map((r) => (
        <form action={prosesSelisih} key={r.id}>
          <p>
            {r.name} ·{" "}
            {new Date(r.closed_at).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            })}{" "}
            · Rp{Number(r.amount).toLocaleString("id-ID")}
          </p>
          <input type="hidden" name="id" value={r.id} />
          <SubmitButton className="btn-acc" pendingText="Memproses…">
            Catat piutang dan jurnal
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
