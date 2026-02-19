import { View, Text, StyleSheet } from 'react-native';
import { realTheme } from '../../theme/realTheme';
import { SPACING } from '../../utils/constants';
import { Button, ButtonProps } from './Button';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionProps?: Partial<ButtonProps>;
}

export function EmptyState({ title, message, actionLabel, onAction, actionProps }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
        {actionLabel && onAction && (
          <Button
            label={actionLabel}
            onPress={onAction}
            variant="primary"
            style={styles.button}
            {...actionProps}
          />
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
