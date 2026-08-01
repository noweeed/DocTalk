# Frontend — DocTalk

React + Vite SPA for chatting with PDF documents. Users upload PDFs, ask questions, and get answers with page citations. Includes Stripe-hosted billing for the Pro plan.

---

## Tech Stack

- **Framework:** React 19 + Vite
- **Routing:** React Router (BrowserRouter, declarative mode)
- **Styling:** Tailwind CSS + shadcn/ui
- **State:** React Context (auth) + TanStack Query
- **Language:** JavaScript (JSX)

---

## Routes (`App.jsx`)

| Path | Page |
| --- | --- |
| `/` | Landing page |
| `/login`, `/signup` | Auth pages |
| `/forgot-password`, `/reset-password`, `/change-password` | Password flows |
| `/oauth/callback` | Google OAuth redirect handler (stores JWT) |
| `/dashboard` | Dashboard (recent docs, stats) |
| `/recent`, `/starred`, `/trash` | Document lists |
| `/upload` | PDF upload (drag & drop) |
| `/settings` | User settings (Profile / Appearance / Pricing & Billing) |
| `/documents/:id` | Document viewer + chat |
| `*` | 404 page |

Authenticated pages live under `AppLayout`, which redirects to `/login` when there's no user.

---

## Pages (`src/routes/`)

- **`AppLayout.jsx`** — Shared layout for authenticated pages; checks auth, redirects to `/login`, renders sidebar + outlet
- **`Dashboard.jsx`** — Stat cards + recent documents via `DocCard`, empty state
- **`RecentPage.jsx`** — Recent docs with search, sort, and grid/list toggle
- **`StarredPage.jsx`** / **`TrashPage.jsx`** — Starred and trashed (restore/delete) documents
- **`UploadPage.jsx`** — PDF upload with progress simulation
- **`SettingsPage.jsx`** — Tabs: Profile, Appearance, Pricing & Billing
  - **Profile** — edit name, change password, avatar upload, plan badge, usage stats
  - **Appearance** — dark/light theme toggle
  - **Billing** — plan cards wired to Stripe: "Upgrade to Pro" → Checkout URL, "Manage subscription" → Billing Portal URL, past-due banner with "Update payment method"; shows a success toast when Stripe redirects back with `?upgraded=true`
- **`DocumentChat.jsx`** — Core feature: PDF viewer (zoom/page nav) + resizable AI chat panel with streaming responses and page citations
- **`login.jsx`, `signup.jsx`** — Auth forms using `useAuth()`
- **`ForgotPasswordPage.jsx`, `ResetPasswordPage.jsx`, `ChangePasswordPage.jsx`** — Password flows
- **`OAuthCallback.jsx`** — Handles Google OAuth redirect and JWT storage
- **`index.jsx`** — Public landing page

---

## Components (`src/components/`)

- **`app-sidebar.jsx`** — Nav sidebar (fixed on desktop, drawer on mobile)
- **`top-bar.jsx`** — Sticky header: title, theme toggle, avatar menu (links to Billing)
- **`doc-card.jsx`** — Document card with star + context menu (rename, star, delete, restore)
- **`auth-shell.jsx`** — Shared login/signup layout
- **`ui/`** — Standard shadcn/ui components (Radix-based)

---

## Utilities & Services (`src/lib/`)

- **`api.js`** — Fetch wrapper adding `Bearer` token from `localStorage`; `get/post/patch/del`
- **`auth-context.jsx`** — Auth state + `login/signup/logout`, restores session on mount, exposes `refreshUser()` (refetches `/me` — picks up plan changes after a Stripe redirect)
- **`documents.js`**, **`conversations.js`** — Plain API wrappers for document/conversation endpoints
- **`streamMessage.js`** — SSE streaming client for chat answers
- **`theme.jsx`** — Dark/light theme persisted to storage
- **`utils.js`** — `cn()` Tailwind class merger

## Hooks (`src/hooks/`)

- **`use-mobile.jsx`** — `useIsMobile()` viewport detection
