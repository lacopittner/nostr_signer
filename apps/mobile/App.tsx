import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { DemoSignerAdapter, IdentityVault, type VaultState } from "@nostr-signer/signer-core";

import { AsyncStorageVault } from "./src/asyncStorageVault";

const vault = new IdentityVault(new AsyncStorageVault(), new DemoSignerAdapter());

function randomHex(size: number): string {
  const alphabet = "0123456789abcdef";
  return Array.from({ length: size })
    .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
    .join("");
}

export default function App() {
  const [snapshot, setSnapshot] = useState<VaultState | null>(null);
  const [status, setStatus] = useState("Vault ready");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await vault.getSnapshot();
    setSnapshot(next);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const existing = await vault.listIdentities();
      if (existing.length === 0) {
        await vault.addIdentity({
          label: "Personal",
          pubkey: randomHex(64),
          npub: `npub1mobile${randomHex(8)}`,
        });
      }

      await refresh();
    };

    void bootstrap();
  }, [refresh]);

  const list = useMemo(() => {
    return [...(snapshot?.identities ?? [])].sort((a, b) => {
      if (a.id === snapshot?.activeIdentityId) {
        return -1;
      }
      if (b.id === snapshot?.activeIdentityId) {
        return 1;
      }
      return b.lastUsedAt - a.lastUsedAt;
    });
  }, [snapshot]);

  const isUnlocked = useCallback(
    (identityId: string) => {
      const expiry = snapshot?.unlockedSessions[identityId] ?? 0;
      return expiry > Date.now();
    },
    [snapshot?.unlockedSessions],
  );

  const addIdentity = useCallback(async () => {
    await vault.addIdentity({
      label: `Identity ${(snapshot?.identities.length ?? 0) + 1}`,
      pubkey: randomHex(64),
      npub: `npub1mobile${randomHex(8)}`,
    });
    setStatus("New identity created");
    await refresh();
  }, [refresh, snapshot?.identities.length]);

  const switchIdentity = useCallback(
    async (identityId: string) => {
      await vault.setActiveIdentity(identityId);
      await refresh();
    },
    [refresh],
  );

  const toggleLock = useCallback(
    async (identityId: string) => {
      if (isUnlocked(identityId)) {
        await vault.lockIdentity(identityId);
        setStatus("Identity locked");
      } else {
        await vault.unlockIdentity(identityId, 15 * 60 * 1000);
        setStatus("Identity unlocked for 15 minutes");
      }

      await refresh();
    },
    [isUnlocked, refresh],
  );

  const signTest = useCallback(async () => {
    try {
      const signed = await vault.signEvent({
        kind: 1,
        content: "Signed from Nostr Signer mobile vault",
        tags: [["client", "nostr-signer-mobile"]],
      });

      setStatus(`Signed ${signed.id.slice(0, 12)}...`);
      setError(null);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Signing failed");
    }
  }, [refresh]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={["#f9dbc6", "#f1f0e6", "#ebebe2"]} style={styles.root}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>NOSTR VAULT</Text>
          <Text style={styles.title}>Mobile Signer</Text>
          <Text style={styles.subtitle}>One app, multiple identities, session unlock and quick sign flow.</Text>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {list.map((identity) => {
            const unlocked = isUnlocked(identity.id);
            const active = identity.id === snapshot?.activeIdentityId;
            return (
              <View key={identity.id} style={[styles.identityCard, active ? styles.identityCardActive : null]}>
                <Pressable onPress={() => void switchIdentity(identity.id)} style={styles.identityMain}>
                  <View style={[styles.avatar, { backgroundColor: identity.color }]}>
                    <Text style={styles.avatarLabel}>{identity.label.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={styles.identityMeta}>
                    <Text style={styles.identityTitle}>{identity.label}</Text>
                    <Text style={styles.identitySub}>{identity.npub ?? identity.pubkey.slice(0, 10)}</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => void toggleLock(identity.id)}
                  style={[styles.lockButton, unlocked ? styles.lockDanger : styles.lockNeutral]}
                >
                  <Text style={[styles.lockLabel, unlocked ? styles.lockLabelDanger : styles.lockLabelNeutral]}>
                    {unlocked ? "Lock" : "Unlock"}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable style={styles.primaryAction} onPress={() => void signTest()}>
            <Text style={styles.primaryActionText}>Sign test event</Text>
          </Pressable>
          <Pressable style={styles.secondaryAction} onPress={() => void addIdentity()}>
            <Text style={styles.secondaryActionText}>Add identity</Text>
          </Pressable>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Status</Text>
          <Text style={styles.statusBody}>{status}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f9dbc6",
  },
  root: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(35, 35, 31, 0.14)",
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    padding: 14,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#595d51",
    fontWeight: "700",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1f1f1a",
  },
  subtitle: {
    fontSize: 13,
    color: "#595d51",
    lineHeight: 18,
  },
  list: {
    gap: 9,
    paddingBottom: 10,
  },
  identityCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(35, 35, 31, 0.14)",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  identityCardActive: {
    borderColor: "rgba(23, 63, 96, 0.44)",
  },
  identityMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: {
    color: "white",
    fontWeight: "800",
  },
  identityMeta: {
    flex: 1,
    minWidth: 0,
  },
  identityTitle: {
    fontWeight: "700",
    fontSize: 14,
    color: "#1f1f1a",
  },
  identitySub: {
    fontSize: 12,
    color: "#595d51",
  },
  lockButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  lockNeutral: {
    borderColor: "rgba(23, 63, 96, 0.3)",
    backgroundColor: "rgba(23, 63, 96, 0.1)",
  },
  lockDanger: {
    borderColor: "rgba(141, 32, 54, 0.35)",
    backgroundColor: "rgba(141, 32, 54, 0.08)",
  },
  lockLabel: {
    fontWeight: "700",
    fontSize: 12,
  },
  lockLabelNeutral: {
    color: "#173f60",
  },
  lockLabelDanger: {
    color: "#8d2036",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  primaryAction: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#173f60",
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryActionText: {
    color: "white",
    fontWeight: "800",
    fontSize: 13,
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(35, 35, 31, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryActionText: {
    color: "#1f1f1a",
    fontWeight: "700",
    fontSize: 13,
  },
  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(35, 35, 31, 0.14)",
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    padding: 12,
    gap: 4,
  },
  statusTitle: {
    fontWeight: "800",
    color: "#1f1f1a",
    fontSize: 14,
  },
  statusBody: {
    color: "#595d51",
    fontSize: 13,
  },
  error: {
    color: "#8d2036",
    fontWeight: "700",
    fontSize: 12,
  },
});
