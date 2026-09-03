import { AuthForm } from "@/components/AuthForm";
import { signup } from "./actions";
export default function SignupPage() {
  return <AuthForm mode="signup" action={signup} />;
}
