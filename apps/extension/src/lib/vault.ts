import { DemoSignerAdapter, IdentityVault } from "@nostr-signer/signer-core";

import { ExtensionVaultStorage } from "./extensionStorage";

export const vault = new IdentityVault(new ExtensionVaultStorage(), new DemoSignerAdapter());
