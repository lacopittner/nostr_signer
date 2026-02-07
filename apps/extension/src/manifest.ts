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
  permissions: ["storage", "alarms"],
  host_permissions: ["https://*/*", "http://*/*"],
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_start"
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/inpage.ts"],
      matches: ["<all_urls>"],
      use_dynamic_url: true,
    },
  ],
  browser_specific_settings: {
    gecko: {
      id: "nostr-signer@local",
      strict_min_version: "121.0",
    },
  },
};

export default manifest;
