import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      navigate("/login?oauth=error", { replace: true });
      return;
    }

    const exchangeKey = `oauth_exchanged_${code}`;
    if (sessionStorage.getItem(exchangeKey)) {
      return;
    }
    sessionStorage.setItem(exchangeKey, "1");

    api
      .post("/api/auth/oauth/exchange", { code })
      .then(async (res) => {
        localStorage.setItem("token", res.token);
        await refreshUser();
        navigate("/dashboard", { replace: true });
      })
      .catch((err) => {
        console.error("OAuth exchange failed:", err);
        sessionStorage.removeItem(exchangeKey);
        localStorage.removeItem("token");
        navigate("/login?oauth=error", { replace: true });
      });
  }, [searchParams, navigate, refreshUser]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
