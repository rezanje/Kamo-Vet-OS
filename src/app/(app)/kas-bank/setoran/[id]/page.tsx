import { SetoranDetailView } from "@/components/setoran/SetoranDetailView";

export default async function DetailSetoranPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const { id } = await params; const { error, success } = await searchParams;
  return <SetoranDetailView id={id} basis="/kas-bank/setoran" error={error} success={success} />;
}
