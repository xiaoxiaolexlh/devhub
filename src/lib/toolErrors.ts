/** Network/version lookup failures stay quiet; local installation-state failures must be visible. */
export function toolStateErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    error.kind === "state" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return null;
}
