export function originAllowed(requestOrigin, pageOrigin) {
  if (typeof requestOrigin !== "string" || typeof pageOrigin !== "string") return false;
  if (requestOrigin === pageOrigin) return true;
  try {
    const page = new URL(pageOrigin);
    const request = new URL(requestOrigin);
    const local = request.hostname === "localhost" || request.hostname === "127.0.0.1";
    const pageLocal = page.hostname === "localhost" || page.hostname === "127.0.0.1";
    return local && pageLocal && request.protocol === page.protocol && request.port === page.port;
  } catch {
    return false;
  }
}
