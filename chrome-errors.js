/**
 * Chrome always reports extension runtime errors in English, regardless of the
 * browser or extension UI language. These sentinels must therefore never go
 * through i18n() — a translated copy would silently stop matching and flood the
 * log with noise for every non-English user.
 */
export const TAB_GONE_ERRORS = [
  "No tab with id",
  "Receiving end does not exist",
];

export const TRANSIENT_INJECTION_ERRORS = [
  ...TAB_GONE_ERRORS,
  "Could not establish connection",
  "Target page",
  "The tab was closed",
  "Frame with ID",
  "Cannot access contents of the page",
  "Extension context invalidated",
];

function matchesAny(message, sentinels) {
  const text = String(message?.message ?? message ?? "");
  return sentinels.some((sentinel) => text.includes(sentinel));
}

/** The working tab is gone; the scanner should shut down instead of retrying. */
export function isTabGoneError(message) {
  return matchesAny(message, TAB_GONE_ERRORS);
}

/**
 * Flow is between renders or the tab is navigating. Expected during normal
 * operation, so it must not be surfaced as an error.
 */
export function isTransientInjectionError(message) {
  return matchesAny(message, TRANSIENT_INJECTION_ERRORS);
}
