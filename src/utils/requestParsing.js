/**
 * Small helpers for reading raw HTTP input in the presentation layer.
 *
 * These only convert request text into the shapes the application services
 * expect.  They never decide whether a value is valid for the business —
 * that remains the responsibility of the validators and services.
 */

const WHOLE_NUMBER_PATTERN = /^[0-9]+$/;

/**
 * Parse a record id route parameter.
 *
 * @param {string} value - Raw route parameter.
 * @returns {number|null} A positive integer id, or null when malformed.
 */
export function parseRouteId(value) {
  const text = String(value);

  if (!WHOLE_NUMBER_PATTERN.test(text) || Number(text) < 1) {
    return null;
  }

  return Number(text);
}

/**
 * Convert a submitted form value to a number when it is plain whole-number
 * text.  Anything else is passed through unchanged so the application
 * validator can reject it with its normal feedback.
 *
 * @param {unknown} value - Raw form value.
 * @returns {number|unknown} A number, or the original value.
 */
export function toNumberIfWhole(value) {
  if (typeof value === "string" && WHOLE_NUMBER_PATTERN.test(value.trim())) {
    return Number(value.trim());
  }

  return value;
}
