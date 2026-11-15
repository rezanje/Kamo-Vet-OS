import { LampiranKasScreen } from "../../../kas/LampiranKasScreen";

export default function LampiranKasKeluarPage({ params }: { params: Promise<{ id: string }> }) {
  return <LampiranKasScreen jenis="Keluar" params={params} />;
}
