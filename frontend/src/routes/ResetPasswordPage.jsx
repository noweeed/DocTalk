import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { AuthShell, FieldLabel, TextInput, PrimaryButton } from "@/components/auth-shell";
import { api } from "@/lib/api";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.post("/api/auth/reset-password", { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthShell
        title="Invalid link"
        subtitle="This password reset link is missing or invalid."
        footer={
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Request a new reset link
          </Link>
        }
      >
        <div className="text-center text-sm text-muted-foreground">
          Please try requesting a new password reset.
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell
        title="Password reset"
        subtitle="Your password has been updated."
        footer={
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to login
          </Link>
        }
      >
        <Link
          to="/login"
          className="mt-2 flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Log in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set new password"
      subtitle="Enter your new password below."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to login
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <label className="block">
          <FieldLabel>New password</FieldLabel>
          <TextInput
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <label className="block">
          <FieldLabel>Confirm new password</FieldLabel>
          <TextInput
            type="password"
            placeholder="Repeat your new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <PrimaryButton type="submit" disabled={submitting}>
          {submitting ? "Resetting..." : "Reset password"}
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
