import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

const ReducedMotionContext = createContext(true);

function getInitialReducedMotion(): boolean {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  }

  // Native preference resolution is asynchronous. Starting conservatively avoids
  // flashing motion for users who have already disabled it at OS level.
  return true;
}

export function MotionProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [reducedMotion, setReducedMotion] = useState(getInitialReducedMotion);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled: boolean) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return (
    <ReducedMotionContext.Provider value={reducedMotion}>
      {children}
    </ReducedMotionContext.Provider>
  );
}

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}
