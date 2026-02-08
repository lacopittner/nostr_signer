import type { CrossBrowserManifest } from "./manifest";

const manifest: CrossBrowserManifest = {
  manifest_version: 3,
  name: "Nostr Signer",
  version: "0.1.0",
  description: "Multi-identity Nostr signer with vault-grade UX",
  action: {
    default_popup: "index.html",
    default_title: "Nostr Signer",
  },
  permissions: ["storage", "alarms", "notifications"],
  // Use activeTab instead of wildcard host_permissions
  // This grants access only when user clicks the extension
  host_permissions: [],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_start"
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/inpage.js"],
      matches: ["<all_urls>"],
      use_dynamic_url: true,
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
  browser_specific_settings: {
    gecko: {
      id: "nostr-signer@local",
      strict_min_version: "121.0",
    },
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
};

export default manifest;
