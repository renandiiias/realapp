const INTERNAL_PREVIEW_EMAILS = new Set(["renan.dyas01@gmail.com"]);

function normalizeEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

export function canAccessInternalPreviews(email: string | null | undefined): boolean {
  return INTERNAL_PREVIEW_EMAILS.has(normalizeEmail(email));
}
