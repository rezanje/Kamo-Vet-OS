import { DocumentBackLink } from "@/components/RelatedDocuments";
import { ReturnRecordDetail } from "@/components/returns/ReturnRecordDetail";

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string; from?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  return <><DocumentBackLink from={search.from} /><ReturnRecordDetail kind="sales" id={id} error={search.error} success={search.success} /></>;
}
