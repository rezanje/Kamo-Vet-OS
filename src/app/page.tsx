import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./login/actions";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  // RLS-filtered: STAFF sees only warehouses in their assigned branches; OWNER/ADMIN see all.
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("code, name, type")
    .order("code");

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">VetOS</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {profile?.full_name ?? user.email} · {profile?.role ?? "—"}
          </p>
        </div>
        <form action={logout}>
          <button className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm">
            Keluar
          </button>
        </form>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium text-black/60 dark:text-white/60">
          Gudang yang bisa diakses ({warehouses?.length ?? 0})
        </h2>
        <ul className="divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
          {warehouses?.map((w) => (
            <li key={w.code} className="flex justify-between px-4 py-2 text-sm">
              <span className="font-mono">{w.code}</span>
              <span className="text-black/60 dark:text-white/60">{w.type}</span>
            </li>
          ))}
          {!warehouses?.length && (
            <li className="px-4 py-2 text-sm text-black/60 dark:text-white/60">
              Tidak ada gudang ter-assign untuk akun ini.
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
