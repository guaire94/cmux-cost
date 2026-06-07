/**
 * Normalize an agent-reported model id (e.g. "claude-opus-4-8",
 * "claude-3-5-sonnet-20241022") to an OpenRouter model id (e.g.
 * "anthropic/claude-opus-4.8") by matching against the set of known
 * OpenRouter ids. Overrides win; otherwise we collapse both sides to
 * alphanumerics and look for a containment match, after stripping any
 * trailing 8-digit date stamp.
 *
 * Returns the OpenRouter id, or null when nothing matches.
 */
export function normalizeModelId(
  raw: string,
  knownIds: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
): string | null {
  if (!raw) return null;
  if (overrides[raw]) return overrides[raw];

  // Exact match against a known id already in OpenRouter form.
  if (knownIds.includes(raw)) return raw;

  const needle = collapse(stripDate(raw));
  if (!needle) return null;

  // Prefer the shortest known id that contains the needle, so
  // "claude-opus-4.8" wins over a longer unrelated superstring.
  let best: string | null = null;
  let bestLen = Infinity;
  for (const id of knownIds) {
    const hay = collapse(id);
    if (hay.includes(needle) && id.length < bestLen) {
      best = id;
      bestLen = id.length;
    }
  }
  return best;
}

function stripDate(s: string): string {
  return s.replace(/-?\d{8}$/, "");
}

function collapse(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
