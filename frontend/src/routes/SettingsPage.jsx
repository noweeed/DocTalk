import { TopBar } from "@/components/top-bar";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { User, Palette, CreditCard, Camera, Loader2 } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const tabs = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "billing", label: "Pricing & Billing", icon: CreditCard },
];

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const upgraded = searchParams.get("upgraded");
  const { refreshUser } = useAuth();
  const [tab, setTab] = useState("profile");

  useEffect(() => {
    if (upgraded === "true") {
      toast.success("Welcome to Pro! Your subscription is active.");
      refreshUser();
      setTab("billing");
    } else if (upgraded === "false") {
      toast.info("Upgrade cancelled — you can try again anytime.");
    }

    if (upgraded) {
      const params = new URLSearchParams(searchParams);
      params.delete("upgraded");
      setSearchParams(params, { replace: true });
    }
  }, [upgraded]);

  useEffect(() => {
    if (tabParam && tabs.some((t) => t.id === tabParam)) {
      setTab(tabParam);
    }
  }, [tabParam]);

  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
          <aside className="flex flex-row gap-1 overflow-x-auto md:flex-col">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </aside>
          <div className="min-w-0">
            {tab === "profile" && <ProfileTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "billing" && <BillingTab />}
          </div>
        </div>
      </main>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ProfileTab() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [passwordSending, setPasswordSending] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.patch("/api/auth/me", { name });
      updateUser(updated);
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordSending(true);
    try {
      await api.post("/api/auth/password/request");
      toast.success("Check your email for a link to continue changing your password.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPasswordSending(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:3000"}/api/auth/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      updateUser({ avatarUrl: data.avatarUrl });
      toast.success("Avatar updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAvatarUploading(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const planLabel = user?.plan === "pro" ? "Pro" : "Free";
  const planBadgeClass = user?.plan === "pro"
    ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground";

  return (
    <div className="space-y-6">
      <Section title="Profile">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-accent text-2xl font-semibold text-foreground">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                (user?.name || "U").charAt(0).toUpperCase()
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-60"
            >
              {avatarUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-semibold tracking-tight text-foreground truncate">{user?.name}</div>
            <div className="mt-0.5 text-sm text-muted-foreground truncate">{user?.email}</div>
          </div>
          <span className={cn("ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium", planBadgeClass)}>
            {planLabel}
          </span>
        </div>

        <div className="mt-6 max-w-sm">
          <Field label="Full name" value={name} onChange={setName} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background px-3 py-2.5">
            <div className="text-xs font-medium text-muted-foreground">Documents uploaded</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">{user?.documentsCount ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2.5">
            <div className="text-xs font-medium text-muted-foreground">Questions this month</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {user?.questionsUsedThisMonth ?? "—"} / {user?.plan === "pro" ? "∞" : "50"}
            {user?.plan === "pro"
              ? user?.stripeSubscriptionEndsAt
                ? <span className="ml-1 text-xs font-normal text-muted-foreground">renews {formatDate(user.stripeSubscriptionEndsAt)}</span>
                : null
              : user?.usageResetAt
                ? <span className="ml-1 text-xs font-normal text-muted-foreground">resets {formatDate(user.usageResetAt)}</span>
                : null}
          </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            onClick={handlePasswordChange}
            disabled={passwordSending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {passwordSending ? "Sending..." : "Change password"}
          </button>
        </div>

      </Section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function AppearanceTab() {
  const { theme, toggle } = useTheme();
  return (
    <Section title="Appearance">
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary">
            {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">
              {theme === "dark" ? "Dark" : "Light"} mode
            </div>
            <div className="text-xs text-muted-foreground">
              {theme === "dark" ? "Easier on the eyes for long reading sessions." : "Bright and crisp for daytime use."}
            </div>
          </div>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={theme === "dark"}
          className={cn(
            "relative h-6 w-11 cursor-pointer rounded-full transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            theme === "dark" ? "bg-primary" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              theme === "dark" ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </Section>
  );
}

function MoonIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="5" /><path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function BillingTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const isPro = user?.plan === "pro";
  const isPastDue = user?.planStatus === "past_due";

  const goTo = async (path) => {
    setLoading(true);
    try {
      const { url } = await api.post(path);
      window.location.href = url;
    } catch (err) {
      toast.error(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">Choose your plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">Upgrade anytime. Cancel anytime.</p>
      </div>

      {isPastDue && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="text-sm text-foreground">
            <span className="font-semibold">Your payment failed.</span> Update your payment method to keep
            Pro access.
          </div>
          <button
            onClick={() => goTo("/api/billing/portal")}
            disabled={loading}
            className="rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-destructive/10 disabled:opacity-60"
          >
            Update payment method
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PlanCard
          name="Free"
          price="$0"
          features={["5 documents", "50 questions / month", "Standard model", "Email support"]}
          current={!isPro}
          hideAction={isPro}
        />
        <PlanCard
          name="Pro"
          price="$5"
          highlight
          features={[
            "Unlimited documents",
            "Unlimited questions",
            "Priority model & speed",
            "Multi-document chat",
            "Priority support",
          ]}
          current={isPro}
          actionLabel="Upgrade to Pro"
          onClick={() => goTo("/api/billing/upgrade")}
          onManage={isPro ? () => goTo("/api/billing/portal") : null}
          loading={loading}
        />
      </div>
    </div>
  );
}

function PlanCard({ name, price, features, highlight, current, actionLabel, onClick, onManage, loading, hideAction }) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card p-6",
        highlight ? "border-primary/60 shadow-glow" : "border-border",
      )}
    >
      {highlight && (
        <span className="absolute -top-3 right-6 rounded-full gradient-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
          Most popular
        </span>
      )}
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-semibold text-foreground">{name}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tracking-tight text-foreground">{price}</span>
        <span className="text-sm text-muted-foreground">/month</span>
      </div>
      <ul className="mt-5 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-foreground">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {f}
          </li>
        ))}
      </ul>
      {!hideAction && (
        <button
          disabled={current || loading}
          onClick={onClick}
          className={cn(
            "mt-6 h-10 rounded-lg text-sm font-medium transition-colors",
            current
              ? "cursor-not-allowed border border-border text-muted-foreground"
              : highlight
                ? "gradient-primary text-primary-foreground shadow-glow hover:brightness-110"
                : "border border-border text-foreground hover:bg-accent",
          )}
        >
          {loading ? "Redirecting…" : current ? "Current plan" : actionLabel}
        </button>
      )}
      {current && onManage && (
        <button
          onClick={onManage}
          disabled={loading}
          className="mt-2 h-9 w-full rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
        >
          Manage subscription
        </button>
      )}
    </div>
  );
}

function CheckIcon(props) {
  return (
    <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
