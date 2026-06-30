import { createClient } from "@/lib/supabase/server";
import { PelangganClient, type CustomerRow } from "./PelangganClient";

export default async function PelangganPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select(
      "id, name, phone, email, dob, address, tier, keanggotaan, points, total_spending, catatan, pekerjaan, sumber_info, created_at, " +
        "pets(id, name, species, breed, gender, dob, weight, warna, sterilisasi, golongan_darah, status, created_at)"
    )
    .order("total_spending", { ascending: false });

  return <PelangganClient customers={(data ?? []) as unknown as CustomerRow[]} />;
}
