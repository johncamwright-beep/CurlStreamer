import { PasswordForm } from "./PasswordForm";
import { signOut } from "@/app/account/actions";
export default function PilotPasswordPage() {
  return (
    <main className="mx-auto max-w-lg p-5">
      <PasswordForm />
      <form action={signOut}>
        <button className="btn-secondary mt-4">Sign out</button>
      </form>
    </main>
  );
}
