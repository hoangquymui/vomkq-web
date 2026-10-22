export function isExplicitUserStop(stopRequestedId, activeRequestId, currentRequestId) {
  // null === null must never turn an HTTP/model error into a user cancellation.
  if (typeof stopRequestedId !== "string" || !stopRequestedId) return false;
  const requestId = activeRequestId || currentRequestId;
  return typeof requestId === "string" && Boolean(requestId) && stopRequestedId === requestId;
}
