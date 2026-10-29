import { t } from "../store/i18n";
import { localDay } from "./upload";

const DAY = 24 * 3600 * 1000;
const BROWSER_NAMES: { [browser: string]: string } = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
};

function language() {
  return chrome.i18n.getUILanguage();
}

export function formatDate(time: number) {
  return new Date(time).toLocaleDateString(language(), {
    day: "numeric",
    month: "long",
  });
}

export function formatTime(time: number) {
  return new Date(time).toLocaleTimeString(language(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMoment(time: number) {
  return localDay(time) === localDay()
    ? t("drive_today_at", formatTime(time))
    : `${formatDate(time)}, ${formatTime(time)}`;
}

export function dayTime(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, (month || 1) - 1, date || 1).getTime();
}

export function copyTitle(day: string) {
  const date = formatDate(dayTime(day));
  return day === localDay() ? t("drive_today_date", date) : date;
}

export function epochDayDate(day: number) {
  return formatDate(day * DAY);
}

export function browserName(browser: string) {
  return BROWSER_NAMES[browser] ?? browser;
}

export function accountsCount(count: number) {
  const form = new Intl.PluralRules(language()).select(count);
  return t(
    `drive_accounts_${["one", "few", "many"].includes(form) ? form : "other"}`,
    String(count),
  );
}
