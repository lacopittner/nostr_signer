# Nostr Signer

Cross-platform Nostr signer foundation for:
- Chrome + Firefox extension
- iOS + Android mobile app

The project starts with a shared vault/signing core that can be reused by all clients.

## Workspace Layout

- `packages/signer-core`: identity vault, session unlock policy, Nostr event serialization/hash, signer adapter interfaces.
- `apps/extension`: WebExtension (Manifest V3) popup + background worker with multi-identity UX.
- `apps/mobile`: Expo app (iOS/Android) with the same vault flow.

## Product Direction

Target UX: modern, vault-style, fast switching between identities (inspired by Proton Pass).

Current implemented foundation:
- multi-identity vault with active identity
- per-identity unlock windows (time-based session)
- sign flow gated by lock status
- deterministic demo signer adapter for local development
- persistent vault state (extension storage/local fallback, AsyncStorage on mobile)

## Security Model (Next Milestones)

The demo signer is intentionally non-production. Production rollout should include:

1. Real key management adapters:
- extension: WebCrypto + encrypted key material, hardware-backed where possible
- mobile: Secure Enclave / Android Keystore wrappers

2. Unlock policy hardening:
- biometric re-auth
- short inactivity lock and background lock
- per-site permission prompts for signing requests

3. Protocol integrations:
- NIP-07 browser API bridge
- deeplink / callback signing requests for mobile
- relay permission and event kind policy controls

## Getting Started

```bash
npm install
npm run dev:extension
npm run dev:mobile
```

Type checks:

```bash
npm run typecheck
```

## Notes

- Firefox support is defined in `apps/extension/src/manifest.ts` (`browser_specific_settings`).
- UI shells are intentionally opinionated and modern, but still minimal scaffolding.
- If you want, the next step can be implementing a real `SignerAdapter` backed by encrypted `nsec` import + biometrics.
