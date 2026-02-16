import { StyleSheet, Text, TextInput, View } from "react-native";
import { realTheme } from "../../theme/realTheme";

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(166, 173, 185, 0.84)"
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: realTheme.radius.sm,
    backgroundColor: realTheme.colors.panelSoft,
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 92,
    textAlignVertical: "top",
  },
});
