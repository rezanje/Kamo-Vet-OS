import { LampiranKasScreen } from "../../../kas/LampiranKasScreen";

export default function LampiranKasMasukPage({ params }: { params: Promise<{ id: string }> }) {
  return <LampiranKasScreen jenis="Masuk" params={params} />;
}
