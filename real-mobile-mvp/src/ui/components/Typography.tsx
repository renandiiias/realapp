import { StyleSheet, Text, type TextStyle } from "react-native";
import { realTheme } from "../../theme/realTheme";

export function Title({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function SubTitle({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.subTitle, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Kicker({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.kicker, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  kicker: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.title,
    fontSize: 30,
    lineHeight: 36,
  },
  subTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 18,
    lineHeight: 24,
  },
  body: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
  },
});
