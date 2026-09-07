import { SHEET_FORMATS } from "./field-event.js";

/** Sparse, provisional numbering: spoken wins; else next after the highest noted; sheets never provisional. */
export function nextFrameNumber(args: { spoken?: number | null; highestNoted: number | null; format: string }): { frameNumber: number | null; provisional: boolean } {
  if (args.spoken != null) return { frameNumber: args.spoken, provisional: false };
  if (SHEET_FORMATS.includes(args.format)) return { frameNumber: null, provisional: false };
  return { frameNumber: (args.highestNoted ?? 0) + 1, provisional: true };
}
