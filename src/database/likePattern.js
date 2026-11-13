/**
 * Escape character used by every CSMS LIKE search.  SQL using
 * containsPattern() must declare it with: LIKE :pattern ESCAPE '\'
 */
export const LIKE_ESCAPE_CHARACTER = "\\";

/**
 * Build a bound LIKE pattern that matches the search text literally
 * anywhere inside a column.
 *
 * In SQL LIKE, "%" and "_" are wildcards.  Without escaping, a user typing
 * "%" or "_" would change the matching rules of the query instead of
 * searching for that character.  Escaping keeps user input as plain data;
 * only the surrounding "%...%" added here acts as a wildcard.
 *
 * @param {string} searchTerm - Trimmed, non-blank search text.
 * @returns {string} The pattern to bind, e.g. "%50\%%" for "50%".
 */
export function containsPattern(searchTerm) {
  const escaped = searchTerm.replace(
    /[\\%_]/g,
    (character) => `${LIKE_ESCAPE_CHARACTER}${character}`
  );

  return `%${escaped}%`;
}
