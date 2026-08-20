import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  title?: string;
  /** Decorative marks next to visible text should be hidden from AT. */
  decorative?: boolean;
};

/**
 * Inline Lendora mark (white + green). Renders without network assets so it
 * always shows on the dark cinematic landing background.
 */
export function BrandMark({
  className,
  title = "Lendora",
  decorative = false,
}: BrandMarkProps) {
  return (
    <svg
      className={cn("shrink-0 text-white", className)}
      viewBox="0 0 31 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {!decorative ? <title>{title}</title> : null}
      {/* Arc mark paths — white body + green accent on the right arc */}
      <path
        d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
        fill="currentColor"
      />
      <path
        d="M15.32 22.8c3.55 0 6.72.42 9.18 1.08-.08-1.12-.2-2.2-.36-3.24-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.24-7.59v19.63Z"
        fill="#86efac"
        opacity="0.95"
      />
    </svg>
  );
}
