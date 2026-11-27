/**
 * ANVAYA Clinical Display & Name Formatters
 *
 * Implements idempotent presentation-layer formatting for practitioner display names.
 * Strictly display-only: does not alter database-stored entity names or API payloads.
 */

/**
 * Idempotently formats a doctor's display name to ensure exactly one title/honorific.
 *
 * Rules:
 * - If name is null, undefined, or empty/whitespace, returns fallback (default: "Doctor").
 * - Trims leading and trailing whitespace.
 * - If the name already begins with "Dr.", "Dr", or "Doctor" (case-insensitive),
 *   the trimmed name is returned without prepending an additional title.
 * - Otherwise, prepends "Dr. " to the trimmed name.
 * - Names where "dr" is merely a substring/prefix of a word (e.g. "Drake", "Drew")
 *   are not treated as honorifics and correctly receive "Dr. ".
 *
 * @param name - Raw practitioner name from profile or request object
 * @param fallback - Neutral fallback title when name is unavailable (default: "Doctor")
 * @returns Formatted practitioner display name with exactly one honorific
 */
export function formatDoctorDisplayName(
  name: string | null | undefined,
  fallback: string = "Doctor",
): string {
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;

  // Case-insensitive regex matching 'dr.', 'dr', or 'doctor' followed by one or more whitespace characters
  const hasHonorific = /^(?:dr\.?|doctor)\s+/i.test(trimmed);
  if (hasHonorific) {
    return trimmed;
  }
  return `Dr. ${trimmed}`;
}
