import { Link } from "react-router-dom";
import { useState } from "react";
import { AuthShell, FieldLabel, TextInput, PrimaryButton } from "@/components/auth-shell";
import { useAuth } from "@/lib/auth-context";

const GOOGLE_AUTH_URL = `${import.meta.env.VITE_API_URL || "http://localhost:3000"}/api/auth/google`;

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email address.";
    if (password.length < 6) next.password = "Password must be at least 6 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back to DocTalk."
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errors.form && (
          <p className="text-sm text-destructive">{errors.form}</p>
        )}
        <label className="block">
          <FieldLabel>Email</FieldLabel>
          <TextInput
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            autoComplete="email"
            required
          />
        </label>
        <label className="block">
          <div className="flex items-center justify-between">
            <FieldLabel>Password</FieldLabel>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <TextInput
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            autoComplete="current-password"
            required
          />
        </label>
        <PrimaryButton type="submit" disabled={submitting}>
          {submitting ? "Logging in..." : "Log in"}
        </PrimaryButton>
      </form>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>

      <a
        href={GOOGLE_AUTH_URL}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </a>
    </AuthShell>
  );
}
