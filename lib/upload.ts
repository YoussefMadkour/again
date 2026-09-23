export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AcceptedPhotoType = keyof typeof ACCEPTED_PHOTO_TYPES;

export function photoProblem(file: { type: string; size: number }): string | null {
  if (!(file.type in ACCEPTED_PHOTO_TYPES)) return "this needs to be a jpg, png or webp photo";
  if (file.size > MAX_PHOTO_BYTES) return "this photo is larger than 15 MB";
  if (file.size === 0) return "this photo is empty";
  return null;
}
