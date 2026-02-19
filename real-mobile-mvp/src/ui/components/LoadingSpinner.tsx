import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { realTheme } from '../../theme/realTheme';
import { SPACING } from '../../utils/constants';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'small' | 'large';
}

export function LoadingSpinner({ message, size = 'large' }: LoadingSpinnerProps) {
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel="Carregando">
      <ActivityIndicator size={size} color={realTheme.colors.green} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  message: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    textAlign: 'center',
  },
});
