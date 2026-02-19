import { Animated, StyleSheet, View } from "react-native";
import { useEffect, useRef } from "react";
import { realTheme } from "../../theme/realTheme";
import type { ToastState } from "../hooks/useToastMessage";
import { Body } from "./Typography";

const toneStyles = {
  success: {
    borderColor: "rgba(53,226,20,0.66)",
    backgroundColor: "rgba(14, 42, 10, 0.94)",
  },
  info: {
    borderColor: "rgba(132,170,255,0.62)",
    backgroundColor: "rgba(13, 28, 54, 0.94)",
  },
  warning: {
    borderColor: "rgba(255,189,85,0.68)",
    backgroundColor: "rgba(61, 41, 12, 0.95)",
  },
} as const;

export function FloatingToast({
  toast,
  bottom = 106,
}: {
  toast: ToastState | null;
  bottom?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (!toast) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 8, duration: 120, useNativeDriver: true }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, toast, translateY]);

  if (!toast) return null;
  const toneStyle = toneStyles[toast.tone];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        toneStyle,
        {
          bottom,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.dot} />
      <Body style={styles.text}>{toast.message}</Body>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 9,
    zIndex: 2000,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: realTheme.colors.text,
  },
  text: {
    flex: 1,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
});
