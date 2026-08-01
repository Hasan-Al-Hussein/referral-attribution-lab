import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { AnimatedReveal } from '../motion/AnimatedReveal';
import { MotionSurface } from '../motion/MotionSurface';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

interface StatusBannerProps {
  tone: 'info' | 'success' | 'error';
  title: string;
  message: string;
}

export function StatusBanner({ tone, title, message }: StatusBannerProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const toneColor = tone === 'success' ? colors.success : tone === 'error' ? colors.danger : colors.accentStrong;
  const backgroundColor = tone === 'success' ? colors.successSoft : tone === 'error' ? colors.dangerSoft : colors.accentSoft;
  return (
    <AnimatedReveal duration={motion.feedback} distance={8} replayKey={`${tone}-${title}-${message}`}>
      <MotionSurface accentColor={toneColor} borderRadius={radii.md} intensity="quiet">
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
          style={[styles.container, { backgroundColor, borderColor: toneColor }]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.surfaceGlass }]}>
            <Feather
              name={tone === 'success' ? 'check' : tone === 'error' ? 'alert-circle' : 'info'}
              color={toneColor}
              size={17}
            />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: toneColor }]}>{title}</Text>
            <Text style={[styles.message, { color: colors.inkMuted }]}>{message}</Text>
          </View>
        </View>
      </MotionSurface>
    </AnimatedReveal>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 3 },
  title: { fontFamily: typography.family, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  message: { fontFamily: typography.family, fontSize: 13, lineHeight: 20 },
});
