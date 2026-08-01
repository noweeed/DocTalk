import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { updateUser } = useAuth();

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      navigate("/login?oauth=error", { replace: true });
      return;
    }

    api
      .post("/api/auth/oauth/exchange", { code })
      .then((res) => {
        localStorage.setItem("token", res.token);
        updateUser(res.user);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        localStorage.removeItem("token");
        navigate("/login?oauth=error", { replace: true });
      });
  }, [searchParams, navigate, updateUser]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
