import { Link } from "react-router-dom";
import { useState } from "react";
import { AuthShell, FieldLabel, TextInput } from "@/components/auth-shell";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.post("/api/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="If an account with that email exists, we've sent a reset link."
        footer={
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to login
          </Link>
        }
      >
        <div className="text-center text-sm text-muted-foreground">
          No email? Check your spam folder, or try again.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to login
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <label className="block">
          <FieldLabel>Email</FieldLabel>
          <TextInput
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="mt-2 h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}
