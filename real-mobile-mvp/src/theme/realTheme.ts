export const realTheme = {
  colors: {
    bg: "#0B0C0E",
    panel: "#121316",
    panelSoft: "#171922",
    text: "#EDEDEE",
    muted: "#A6ADB9",

    green: "#35E214",
    greenDeep: "#24B90A",
    purple: "#8E00A6",

    line: "rgba(237, 237, 238, 0.12)",
    lineStrong: "rgba(237, 237, 238, 0.2)",

    neonSoft: "rgba(53, 226, 20, 0.18)",
    purpleSoft: "rgba(142, 0, 166, 0.16)",
    dangerSoft: "rgba(255, 95, 95, 0.2)",
  },
  radius: {
    lg: 24,
    md: 18,
    sm: 14,
    pill: 999,
  },
  fonts: {
    // Neue Metana is not bundled; display fallback keeps the visual direction.
    title: "DMSerifDisplay_400Regular",
    bodyRegular: "Montserrat_400Regular",
    bodyMedium: "Montserrat_500Medium",
    bodySemiBold: "Montserrat_600SemiBold",
    bodyBold: "Montserrat_700Bold",
  },
  shadow: {
    glowGreen: {
      shadowColor: "#35E214",
      shadowOpacity: 0.26,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 0 },
      elevation: 9,
    },
  },
} as const;

export type RealTheme = typeof realTheme;
