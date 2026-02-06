import browser from "webextension-polyfill";

browser.runtime.onInstalled.addListener(() => {
  console.info("Nostr Signer installed");
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "PING") {
    return { ok: true, source: "nostr-signer-background" };
  }

  return undefined;
});
