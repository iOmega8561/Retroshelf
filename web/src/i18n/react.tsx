import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../hooks/useStore';
import { prefsStore } from '../lib/store';
import { createTranslator, detectLocale, type Locale, type Translator } from './index';

interface I18nValue extends Translator {
  /** What "Automatic" resolves to right now, shown in the language picker. */
  systemLocale: Locale;
}

const I18nContext = createContext<I18nValue>({ ...createTranslator('en'), systemLocale: 'en' });

export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale: pref } = useStore(prefsStore);
  const [systemLocale, setSystemLocale] = useState<Locale>(detectLocale);

  // Follow OS/browser language changes live while on "Automatic".
  useEffect(() => {
    const onChange = () => setSystemLocale(detectLocale());
    window.addEventListener('languagechange', onChange);
    return () => window.removeEventListener('languagechange', onChange);
  }, []);

  const locale = pref === 'auto' ? systemLocale : pref;
  const value = useMemo(() => ({ ...createTranslator(locale), systemLocale }), [locale, systemLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
