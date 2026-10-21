import { ReturnRecordDetail } from "@/components/returns/ReturnRecordDetail";

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  return <ReturnRecordDetail kind="sales" id={id} {...await searchParams} />;
}
