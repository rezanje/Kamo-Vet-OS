import { InpatientEntryPage } from "../InpatientEntryPage";

export default async function Page(props: { params: Promise<{ id: string }>; searchParams?: Promise<{ error?: string; tab?: string }> }) {
  return InpatientEntryPage({ ...props, mode: "clinical" });
}
