import { KasEntryScreen } from "../kas/KasEntryScreen";

export default function KasKeluarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; entry?: string; bukti?: string }>;
}) {
  return <KasEntryScreen jenis="Keluar" searchParams={searchParams} />;
}
