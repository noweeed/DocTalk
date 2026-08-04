import { Outlet, Navigate } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/ui/skeleton";

export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen w-full bg-background">
        <div className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar p-4 md:flex">
          <Skeleton className="h-6 w-24" />
          <div className="mt-8 space-y-3">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
            <Skeleton className="h-4 w-40" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8 sm:px-6 lg:px-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Skeleton className="h-18 w-full rounded-xl" />
              <Skeleton className="h-18 w-full rounded-xl" />
              <Skeleton className="h-18 w-full rounded-xl" />
            </div>
            <div className="mt-10 space-y-3">
              <Skeleton className="h-4 w-40" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
