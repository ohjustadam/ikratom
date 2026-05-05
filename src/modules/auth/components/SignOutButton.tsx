import { signOut } from "../actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-sm text-zinc-400 hover:text-emerald-400"
      >
        Sign out
      </button>
    </form>
  );
}
