import { AuthForm } from "@/components/AuthForm";
import { login } from "./actions";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="login" action={login} returnTo={next} />;
}
