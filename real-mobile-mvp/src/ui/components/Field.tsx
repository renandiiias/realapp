import { StyleSheet, Text, TextInput, View, TextInputProps } from "react-native";
import { realTheme } from "../../theme/realTheme";
import { SPACING } from "../../utils/constants";

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  error,
  disabled,
  required,
  ...textInputProps
}: FieldProps) {
  const hasError = !!error;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(166, 173, 185, 0.84)"
        multiline={multiline}
        editable={!disabled}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          hasError && styles.inputError,
          disabled && styles.inputDisabled,
        ]}
        accessibilityLabel={label}
        accessibilityRequired={required}
        accessibilityInvalid={hasError}
        {...textInputProps}
      />
      {hasError && (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: SPACING.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  required: {
    color: '#EF4444',
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
    minHeight: 44,
  },
  inputMultiline: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  inputError: {
    borderColor: '#EF4444',
    borderWidth: 1.5,
  },
  inputDisabled: {
    opacity: 0.5,
    backgroundColor: 'rgba(166, 173, 185, 0.1)',
  },
  errorText: {
    color: '#EF4444',
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
    marginTop: -4,
  },
});
