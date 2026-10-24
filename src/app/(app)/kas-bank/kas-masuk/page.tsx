import { KasEntryScreen } from "../kas/KasEntryScreen";

export default function KasMasukPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; entry?: string; bukti?: string }>;
}) {
  return <KasEntryScreen jenis="Masuk" searchParams={searchParams} />;
}
