import { createClient } from "@/lib/supabase/server";
import { downloadHppReport } from "@/lib/hpp-reports-download";
export async function GET(request: Request) {
  return downloadHppReport(await createClient(),"inventory",request);
}
