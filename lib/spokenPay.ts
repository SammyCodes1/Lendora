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

/** Wall-clock parts in the timezone represented by `getTimezoneOffset()`. */
export function localDateParts(
  timezoneOffsetMinutes = new Date().getTimezoneOffset(),
  from = Date.now(),
) {
  const local = new Date(from - timezoneOffsetMinutes * 60_000);
  return {
    weekday: local.getUTCDay(),
    hours: local.getUTCHours(),
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    date: local.getUTCDate(),
  };
}

/** Next weekday at `hour`:00 in the timezone represented by getTimezoneOffset(). */
export function nextWeekdayAtHour(
  weekday: number,
  hour = 9,
  mode: "weekly" | "daily" = "weekly",
  timezoneOffsetMinutes = new Date().getTimezoneOffset(),
  from = Date.now(),
) {
  const local = localDateParts(timezoneOffsetMinutes, from);
  if (mode === "daily") {
    const alreadyPassed = local.hours >= hour;
    const start = Date.UTC(
      local.year,
      local.month,
      local.date + (alreadyPassed ? 1 : 0),
      hour,
      0,
      0,
    );
    return Math.floor((start + timezoneOffsetMinutes * 60_000) / 1000);
  }
  let delta = (weekday - local.weekday + 7) % 7;
  if (delta === 0 && local.hours >= hour) delta = 7;
  const start = Date.UTC(
    local.year,
    local.month,
    local.date + delta,
    hour,
    0,
    0,
  );
  return Math.floor((start + timezoneOffsetMinutes * 60_000) / 1000);
}

export function parseSpokenCadence(
  message: string,
  timezoneOffsetMinutes?: number,
): {
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
    new RegExp(`\\b${day}s?\\b(?!\\.(?:lendora|arclend|arc))`).test(normalized),
  );

  const offset = timezoneOffsetMinutes ?? new Date().getTimezoneOffset();
  const localWeekday = localDateParts(offset).weekday;
  if (weekdayName) {
    return {
      intervalSeconds: WEEK_SECONDS,
      firstRunAt: nextWeekdayAtHour(WEEKDAYS[weekdayName], 9, "weekly", offset),
      label: `every ${weekdayName}`,
      weekday: weekdayName,
    };
  }
  if (/\bdaily\b/.test(normalized) || /\bevery\s+day\b/.test(normalized)) {
    return {
      intervalSeconds: DAY_SECONDS,
      firstRunAt: nextWeekdayAtHour(localWeekday, 9, "daily", offset),
      label: "every day",
    };
  }
  return {
    intervalSeconds: WEEK_SECONDS,
    firstRunAt: nextWeekdayAtHour(localWeekday, 9, "weekly", offset),
    label: "every week",
  };
}

export function parseYieldSource(message: string): boolean {
  return /\b(?:from|using|with)\s+(?:my\s+)?(?:yield|interest|apy|earnings)\b/i.test(
    message,
  );
}
