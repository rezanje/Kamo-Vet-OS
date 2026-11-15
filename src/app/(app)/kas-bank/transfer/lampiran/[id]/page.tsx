import { LampiranKasScreen } from "../../../kas/LampiranKasScreen";

export default function LampiranTransferPage({ params }: { params: Promise<{ id: string }> }) {
  return <LampiranKasScreen jenis="Transfer" params={params} />;
}
