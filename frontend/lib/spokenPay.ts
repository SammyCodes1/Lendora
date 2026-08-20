const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const MIN_PAYMENT_INTERVAL_SECONDS = 15 * 60;
export const WEEK_SECONDS = 7 * 24 * 60 * 60;
export const DAY_SECONDS = 24 * 60 * 60;

export function parseHealthFloor(message: string): string {
  const match =
    message.match(
      /health(?:\s*factor)?\s*(?:above|over|of|at least|>=?)\s*(\d+(?:\.\d+)?)/i,
    ) ?? message.match(/\bhf\s*(?:above|over|>=?|at least)?\s*(\d+(?:\.\d+)?)/i);
  return match?.[1] ?? "1.10";
}

export function healthFactorToWad(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const padded = (fraction + "0".repeat(18)).slice(0, 18);
  try {
    return BigInt(whole) * 10n ** 18n + BigInt(padded || "0");
  } catch {
    return null;
  }
}

export function nextWeekdayUtcSeconds(weekday: number, from = new Date()): number {
  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12, 0, 0),
  );
  const delta = (weekday - start.getUTCDay() + 7) % 7 || 7;
  start.setUTCDate(start.getUTCDate() + delta);
  return Math.floor(start.getTime() / 1000);
}

export function parseSpokenCadence(message: string): {
  intervalSeconds: number;
  firstRunAt: number;
  label: string;
  weekday?: string;
} | null {
  const normalized = message.toLowerCase();
  if (
    !/\bevery\b/.test(normalized) &&
    !/\bweekly\b/.test(normalized) &&
    !/\bdaily\b/.test(normalized) &&
    !/\brecurring\b/.test(normalized) &&
    !/\beach\s+(?:week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/.test(
      normalized,
    )
  ) {
    return null;
  }

  const weekdayName = Object.keys(WEEKDAYS).find((day) =>
    new RegExp(`\\b${day}s?\\b`).test(normalized),
  );
  if (weekdayName) {
    return {
      intervalSeconds: WEEK_SECONDS,
      firstRunAt: nextWeekdayUtcSeconds(WEEKDAYS[weekdayName]),
      label: `every ${weekdayName}`,
      weekday: weekdayName,
    };
  }
  if (/\bdaily\b/.test(normalized) || /\bevery\s+day\b/.test(normalized)) {
    return {
      intervalSeconds: DAY_SECONDS,
      firstRunAt: Math.floor(Date.now() / 1000) + DAY_SECONDS,
      label: "every day",
    };
  }
  return {
    intervalSeconds: WEEK_SECONDS,
    firstRunAt: Math.floor(Date.now() / 1000) + WEEK_SECONDS,
    label: "every week",
  };
}

export function parseYieldSource(message: string): boolean {
  return /\b(?:from|using|with)\s+(?:my\s+)?(?:yield|interest|apy|earnings)\b/i.test(
    message,
  );
}
