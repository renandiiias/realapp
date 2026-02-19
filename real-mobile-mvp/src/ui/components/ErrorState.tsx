import { View, Text, StyleSheet } from 'react-native';
import { realTheme } from '../../theme/realTheme';
import { SPACING } from '../../utils/constants';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = 'Algo deu errado',
  message,
  onRetry,
  retryLabel = 'Tentar novamente',
}: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>⚠️</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        {onRetry && (
          <Button label={retryLabel} onPress={onRetry} variant="primary" style={styles.button} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  content: {
    alignItems: 'center',
    gap: SPACING.md,
    maxWidth: 320,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 32,
  },
  title: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.displayBold,
    fontSize: 20,
    textAlign: 'center',
  },
  message: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: SPACING.sm,
  },
});
