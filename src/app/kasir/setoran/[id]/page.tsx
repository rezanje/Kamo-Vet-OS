import { SetoranDetailView } from "@/components/setoran/SetoranDetailView";

export default async function DetailSetoranKasirPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const { id } = await params; const { error, success } = await searchParams;
  return <SetoranDetailView id={id} basis="/kasir/setoran" error={error} success={success} />;
}
