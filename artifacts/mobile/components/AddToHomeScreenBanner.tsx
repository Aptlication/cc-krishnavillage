import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

const DISMISSED_KEY = "@krishna_village_a2hs_dismissed";

function isInStandaloneMode(): boolean {
  if (Platform.OS !== "web") return false;
  try {
    return (
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    );
  } catch {
    return false;
  }
}

function getOS(): "ios" | "android" | "other" {
  if (Platform.OS !== "web") return "other";
  try {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) return "ios";
    if (/android/i.test(ua)) return "android";
  } catch {}
  return "other";
}

export function AddToHomeScreenBanner() {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [os, setOs] = useState<"ios" | "android" | "other">("other");
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isInStandaloneMode()) return;

    const detectedOs = getOS();
    if (detectedOs === "other") return;

    try {
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (dismissed) return;
    } catch {}

    setOs(detectedOs);

    const timer = setTimeout(() => {
      setVisible(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  function dismiss() {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch {}
    });
  }

  if (!visible) return null;

  const steps =
    os === "ios"
      ? [
          { icon: "share" as const, text: 'Tap the Share button below' },
          { icon: "plus-square" as const, text: '"Add to Home Screen"' },
          { icon: "check-circle" as const, text: 'Then tap \u201cAdd\u201d' },
        ]
      : [
          { icon: "more-vertical" as const, text: "Tap the menu (⋮) above" },
          { icon: "smartphone" as const, text: '"Add to Home Screen"' },
          { icon: "check-circle" as const, text: 'Tap \u201cAdd\u201d' },
        ];

  return (
    <Animated.View style={[styles.wrapper, { opacity }]}>
      <View
        style={[
          styles.banner,
          {
            backgroundColor: colors.card,
            borderColor: colors.primary + "40",
          },
        ]}
      >
        {/* Dismiss */}
        <Pressable onPress={dismiss} style={styles.closeBtn} accessibilityLabel="Dismiss">
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>

        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="home" size={20} color={colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Add to your Home Screen
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              For quick access during your stay
            </Text>
          </View>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          {steps.map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.stepNumber, { backgroundColor: colors.primary }]}>
                <Text style={[styles.stepNumberText, { color: colors.primaryForeground }]}>
                  {i + 1}
                </Text>
              </View>
              <Feather name={step.icon} size={16} color={colors.mutedForeground} />
              <Text style={[styles.stepText, { color: colors.foreground }]}>{step.text}</Text>
            </View>
          ))}
        </View>

        {/* Dismiss link */}
        <Pressable onPress={dismiss} style={styles.dismissLink}>
          <Text style={[styles.dismissLinkText, { color: colors.mutedForeground }]}>
            Dismiss
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  banner: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 1,
    padding: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingRight: 24,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  steps: {
    gap: 10,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  stepText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  dismissLink: {
    alignItems: "center",
    paddingTop: 2,
  },
  dismissLinkText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
