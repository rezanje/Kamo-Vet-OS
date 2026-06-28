import { login } from "./actions";

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
        className="w-full max-w-sm space-y-4 rounded-lg border border-black/10 dark:border-white/15 p-6"
      >
        <div>
          <h1 className="text-xl font-semibold">VetOS</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Masuk ke platform Kamo Group
          </p>
        </div>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <label className="block space-y-1">
          <span className="text-sm">Email</span>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-2"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-2"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded bg-foreground px-3 py-2 font-medium text-background"
        >
          Masuk
        </button>
      </form>
    </main>
  );
}
