// Message label: "Today, 2:34 PM", "Вчера, 22:10", "3 Oct, 09:15", with the
// year added for older messages. Pure, so it is unit-tested with plain Node.
import { dateLocale, makeTimeFormat, type Lang } from "./locale.ts";

const DAY_MS = 86_400_000;

const WORDS: Record<Lang, { today: string; yesterday: string }> = {
  en: { today: "Today", yesterday: "Yesterday" },
  ru: { today: "Сегодня", yesterday: "Вчера" },
};

export interface Formatter {
  label(ms: number, now: Date): string;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function makeFormatter(lang: Lang, hour12: boolean): Formatter {
  const time = makeTimeFormat(lang, hour12);
  const locale = dateLocale(lang);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const dayYear = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const words = WORDS[lang];
  return {
    label(ms, now) {
      const date = new Date(ms);
      const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
      const dayText =
        daysAgo === 0
          ? words.today
          : daysAgo === 1
            ? words.yesterday
            : date.getFullYear() === now.getFullYear()
              ? day.format(date)
              : dayYear.format(date);
      return `${dayText}, ${time.format(date)}`;
    },
  };
}

