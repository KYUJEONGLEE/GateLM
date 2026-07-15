const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
export const DEFAULT_DISPLAY_TIMEZONE = "Asia/Seoul";

function getDateTimeFormatter(timezone: string) {
  const existing = dateTimeFormatters.get(timezone);
  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: timezone
  });
  dateTimeFormatters.set(timezone, formatter);
  return formatter;
}

export function formatDateTime(
  value: string | null | undefined,
  timezone = DEFAULT_DISPLAY_TIMEZONE
) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return getDateTimeFormatter(timezone).format(date);
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatLatency(value: number | null) {
  if (value === null) {
    return "not called";
  }

  return `${formatInteger(value)} ms`;
}

export function formatResponseTimeSeconds(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  const seconds = value / 1000;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 1000 ? 3 : 2,
    minimumFractionDigits: 2
  }).format(seconds);

  return `${formatted} s`;
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent"
  }).format(value);
}

export function formatMicroUsdCurrency(value: number, locale = "en-US") {
  const usd = (Number.isFinite(value) ? Math.max(0, value) : 0) / 1_000_000;

  return new Intl.NumberFormat(locale, {
    currency: "USD",
    maximumFractionDigits: usd > 0 && usd < 1 ? 6 : 2,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(usd);
}

export function formatUsd(value: string) {
  return `$${value}`;
}

export function nullableText(value: string | null | undefined, fallback = "not set") {
  return value && value.length > 0 ? value : fallback;
}
