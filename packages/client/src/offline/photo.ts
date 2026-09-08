/**
 * Normalises a photo before it is ever queued: JPEG, and small enough to be
 * worth sending over a rural LTE connection.
 *
 * Three reasons this happens on the phone rather than the server:
 * the upload route accepts only image/jpeg (an iPhone may hand over HEIC),
 * tier 2 skips images above ~3.5 MB so a full-resolution frame would never get
 * a scene description, and the bytes sit in IndexedDB until there is signal —
 * a 12 MP original is a lot of a phone's storage to hold for a reference shot.
 */

/** Longest edge, in pixels. Ample for a reference shot and for the model. */
const MAX_EDGE = 2048;
const QUALITY = 0.85;
const DECODE_TIMEOUT_MS = 5000;

/** A canvas we can actually draw on, or null where that is not available. */
function canvasOrNull(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  if (typeof canvas.getContext !== "function" || !canvas.getContext("2d")) return null;
  if (typeof canvas.toBlob !== "function") return null;
  return canvas;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

export interface PreparedPhoto {
  blob: Blob;
  mimeType: string;
  /** When the picture was taken, as far as the file knows. */
  takenAt: string;
}

function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });
}

/**
 * Returns a JPEG no larger than MAX_EDGE on its long side. If anything about
 * that fails — an unsupported format, no canvas — the original file is used as
 * it is: a photo that might be rejected later beats no photo at all.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const takenAt = new Date(file.lastModified || Date.now()).toISOString();
  const canvas = canvasOrNull();
  if (!canvas) return { blob: file, mimeType: file.type || "image/jpeg", takenAt };
  try {
    // Decoding is the step that can stall on a corrupt file, so it is bounded.
    const img = await withTimeout(decode(file), DECODE_TIMEOUT_MS);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob) throw new Error("could not encode jpeg");
    return { blob, mimeType: "image/jpeg", takenAt };
  } catch {
    return { blob: file, mimeType: file.type || "image/jpeg", takenAt };
  }
}
