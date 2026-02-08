// Injection guards - prevents injection into invalid pages

export function doctypeCheck(): boolean {
  const doc = document;
  if (!doc) return false;

  // Check for valid HTML doctype
  const doctype = doc.doctype;
  if (!doctype) {
    // Some pages may not have a doctype but are still valid
    return true;
  }

  // Only allow HTML doctypes
  const name = doctype.name?.toLowerCase() ?? "";
  return name === "html" || name === "";
}

export function suffixCheck(): boolean {
  const doc = document;
  if (!doc || !doc.location) return false;

  const href = doc.location.href;
  if (!href) return true;

  // Skip injection for certain URL patterns
  const prohibitedPatterns = [
    /\.pdf$/i,
    /\.xml$/i,
    /\.xhtml$/i,
    /\.(png|jpe?g|gif|svg|webp|ico)$/i,
    /\?.*format=(pdf|xml)/i,
  ];

  return !prohibitedPatterns.some((pattern) => pattern.test(href));
}

export function documentElementCheck(): boolean {
  const doc = document;
  if (!doc || doc.documentElement?.tagName?.toLowerCase() !== "html") {
    return false;
  }
  return true;
}

export default async function shouldInject(): Promise<boolean> {
  try {
    const doctypeResult = doctypeCheck();
    if (!doctypeResult) {
      console.debug("[Nostr Signer] Skipping injection: invalid doctype");
      return false;
    }

    const suffixResult = suffixCheck();
    if (!suffixResult) {
      console.debug("[Nostr Signer] Skipping injection: prohibited file type");
      return false;
    }

    const documentElementResult = documentElementCheck();
    if (!documentElementResult) {
      console.debug("[Nostr Signer] Skipping injection: invalid document element");
      return false;
    }

    return true;
  } catch {
    // If any check fails, be conservative and skip injection
    return false;
  }
}
