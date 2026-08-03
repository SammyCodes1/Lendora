import { cn } from "@/lib/utils";

type HealthFactorValueProps = {
  value: number;
  className?: string;
};

function formatHealth(value: number) {
  return value > 9 ? "Max" : value.toFixed(2);
}

export function HealthFactorValue({ value, className }: HealthFactorValueProps) {
  return (
    <span className={cn("tabular-nums", className)} aria-label={`Health factor ${formatHealth(value)}`}>
      {formatHealth(value)}
    </span>
  );
}
