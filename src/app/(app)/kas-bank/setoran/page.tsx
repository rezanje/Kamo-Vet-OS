import { SetoranDaftarView } from "@/components/setoran/SetoranDaftarView";

export default async function RekapSetoranPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <SetoranDaftarView basis="/kas-bank/setoran" sp={await searchParams} />;
}
