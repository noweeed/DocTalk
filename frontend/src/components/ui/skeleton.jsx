import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }) {
  return (
    <div className={cn("shimmer relative overflow-hidden rounded-md bg-muted", className)} {...props} />
  );
}

export { Skeleton };
