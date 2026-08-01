import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

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
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
