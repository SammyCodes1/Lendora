import { cn } from "@/lib/utils";

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
};

export function Skeleton({ width = "100%", height = 16, className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-white/[0.05]", className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
