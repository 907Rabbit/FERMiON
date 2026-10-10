/**
 * Splits a tool identifier into lexical tokens before indexing.
 * BM25 barely matches `sessions_spawn` against "sessions spawn" when the name
 * stays one opaque token.
 */
export function normalizeToolIdentifier(name: string): string {
  const separated = name.replace(/[_\-./:]+/g, " ");
  const decamel = separated
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2");
  return decamel.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Name field text: lexical parts plus the raw identifier, so either form can hit. */
export function toolNameDocument(name: string): string {
  const normalized = normalizeToolIdentifier(name);
  const raw = name.trim().toLowerCase();
  if (raw.length === 0 || normalized === raw) {
    return normalized;
  }
  return `${normalized} ${raw}`;
}
