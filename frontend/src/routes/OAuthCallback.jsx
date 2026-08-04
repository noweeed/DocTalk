import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      navigate("/login?oauth=error", { replace: true });
      return;
    }

    const exchangeKey = `oauth_exchanged_${code}`;
    if (sessionStorage.getItem(exchangeKey)) {
      return; // already handled (or in flight) for this exact code
    }
    sessionStorage.setItem(exchangeKey, "1");

    api
      .post("/api/auth/oauth/exchange", { code })
      .then((res) => {
        localStorage.setItem("token", res.token);
        setUser(res.user);
        navigate("/dashboard", { replace: true });
      })
      .catch((err) => {
        console.error("OAuth exchange failed:", err);
        sessionStorage.removeItem(exchangeKey);
        localStorage.removeItem("token");
        navigate("/login?oauth=error", { replace: true });
      });
  }, [searchParams, navigate, setUser]);

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-center gap-2">
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );
}
