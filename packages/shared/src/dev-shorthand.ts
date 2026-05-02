/**
 * Parse film development shorthand into structured fields.
 *
 * Supports:
 *   HC110 letter codes:    "B7.5", "E10:40", "H10", "F9"
 *   Massive Dev ratios:    "1:50/8mins", "1:25 / 13 mins", "1:100/80"
 *   Bare time:             "8mins", "10:40", "7.5"
 *
 * Times: a bare decimal is minutes ("7.5" = 7m30s); "M:SS" is minutes:seconds.
 *
 * Returns null fields for anything unparseable so callers can fall back
 * to storing the raw string and leaving structured fields empty.
 */
export interface ParsedDevShorthand {
  raw: string;
  dilution: string | null;
  devTimeSeconds: number | null;
}

const HC110_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

function parseTime(input: string): number | null {
  const trimmed = input.trim().replace(/\s*(min|mins|m)\s*$/i, "");
  if (!trimmed) return null;

  // M:SS form
  const colon = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colon) {
    const m = Number(colon[1]);
    const s = Number(colon[2]);
    if (Number.isFinite(m) && Number.isFinite(s) && s < 60) {
      return Math.round(m * 60 + s);
    }
    return null;
  }

  // Decimal minutes
  const dec = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (dec) {
    const m = Number(dec[1]);
    if (Number.isFinite(m)) return Math.round(m * 60);
  }

  return null;
}

export function parseDevShorthand(input: string): ParsedDevShorthand {
  const raw = input;
  const cleaned = input.trim();

  // HC110 letter code: optional leading dilution letter, then a time.
  // Tolerate a trailing `+` (push) or stray punctuation by ignoring everything past the time.
  const letter = cleaned.match(/^([A-Ha-h])\s*(\d+(?::\d{1,2})?(?:\.\d+)?)/);
  if (letter && HC110_LETTERS.includes(letter[1].toUpperCase() as typeof HC110_LETTERS[number])) {
    const seconds = parseTime(letter[2]);
    return {
      raw,
      dilution: letter[1].toUpperCase(),
      devTimeSeconds: seconds,
    };
  }

  // Ratio form: "1:50/8mins" or "1:50 / 8 mins" or "1:25 / 13 mins"
  const ratio = cleaned.match(/^(\d+:\d+)\s*[/]\s*(.+)$/);
  if (ratio) {
    return {
      raw,
      dilution: ratio[1],
      devTimeSeconds: parseTime(ratio[2]),
    };
  }

  // Bare time
  const seconds = parseTime(cleaned);
  if (seconds != null) {
    return { raw, dilution: null, devTimeSeconds: seconds };
  }

  return { raw, dilution: null, devTimeSeconds: null };
}
