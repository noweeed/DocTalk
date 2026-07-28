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
    const token = searchParams.get("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    localStorage.setItem("token", token);

    api.get("/api/auth/me")
      .then((user) => {
        updateUser(user);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        localStorage.removeItem("token");
        navigate("/login", { replace: true });
      });
  }, [searchParams, navigate, updateUser]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
