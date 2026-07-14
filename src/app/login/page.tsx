import { login } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-lg border border-black/10 p-6 text-black"
      >
        <div>
          <h1 className="text-xl font-semibold">VetOS</h1>
          <p className="text-sm text-black/60">
            Masuk ke platform Kamo Group
          </p>
        </div>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="block space-y-1">
          <span className="text-sm">Email</span>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded border border-black/15 bg-white px-3 py-2 text-black"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded border border-black/15 bg-white px-3 py-2 text-black"
          />
        </label>

        <SubmitButton
          className="w-full rounded bg-foreground px-3 py-2 font-medium text-background"
          pendingText="Masuk…"
        >
          Masuk
        </SubmitButton>

        {/* Demo only: daftar akun uji coba biar gampang login. Hapus sebelum produksi. */}
        <div className="rounded border border-dashed border-black/20 p-3 text-xs text-black/60 space-y-1">
          <p className="font-semibold text-black/70">Akun demo (password: password123)</p>
          <p><span className="font-medium">owner@vetos.local</span> — OWNER</p>
          <p><span className="font-medium">claude-test@vetos.local</span> — ADMIN</p>
          <p><span className="font-medium">staff@vetos.local</span> — STAFF (kasir)</p>
          <p><span className="font-medium">finance@vetos.local</span> — FINANCE (keuangan)</p>
        </div>
      </form>
    </main>
  );
}
