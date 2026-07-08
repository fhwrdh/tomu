/**
 * Dev Id formatting — the lifetime development identifier.
 *
 * A Dev Id is `YYYYMMDD.NNNN`: the local dev date plus the cumulative
 * dev sequence number (zero-padded to 4). The seq half is the real
 * identifier — it's what links a roll across Lightroom keywords, the
 * pre-Tomu dev log sheet, and Tomu. The date half is context.
 */

/** Format a Dev Id from its parts. Returns null unless both are present. */
export function formatDevId(
  devDate: string | null | undefined,
  devSeq: number | null | undefined,
): string | null {
  if (devSeq == null || !devDate) return null;
  const ymd = devDate.slice(0, 10).replace(/-/g, "");
  return `${ymd}.${String(devSeq).padStart(4, "0")}`;
}

/**
 * Parse a dev-seq range like "717-735", "0717-0735", or a single "721".
 * Returns [from, to] inclusive, or null if unparseable.
 */
export function parseDevSeqRange(input: string): [number, number] | null {
  const m = input.trim().match(/^(\d{1,5})\s*[-–]\s*(\d{1,5})$/);
  if (m) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    return from <= to ? [from, to] : [to, from];
  }
  const single = input.trim().match(/^\d{1,5}$/);
  if (single) {
    const n = Number(single[0]);
    return [n, n];
  }
  return null;
}
