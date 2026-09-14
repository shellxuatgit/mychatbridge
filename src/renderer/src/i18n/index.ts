import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import zhTW from './locales/zh-TW.json'
import jaJP from './locales/ja-JP.json'
import koKR from './locales/ko-KR.json'
import esES from './locales/es-ES.json'
import frFR from './locales/fr-FR.json'
import deDE from './locales/de-DE.json'
import ruRU from './locales/ru-RU.json'

const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
  'zh-TW': { translation: zhTW },
  'ja-JP': { translation: jaJP },
  'ko-KR': { translation: koKR },
  'es-ES': { translation: esES },
  'fr-FR': { translation: frFR },
  'de-DE': { translation: deDE },
  'ru-RU': { translation: ruRU },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en-US',
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
      convertDetectedLanguage: (lng: string) => {
        const normalized = lng.toLowerCase()
        if (normalized.includes('zh-tw') || normalized.includes('zh-hk') || normalized.includes('zh-mo')) return 'zh-TW'
        if (normalized.includes('zh')) return 'zh-CN'
        if (normalized.includes('ja')) return 'ja-JP'
        if (normalized.includes('ko')) return 'ko-KR'
        if (normalized.includes('es')) return 'es-ES'
        if (normalized.includes('fr')) return 'fr-FR'
        if (normalized.includes('de')) return 'de-DE'
        if (normalized.includes('ru')) return 'ru-RU'
        return 'en-US'
      },
    },
  })

export default i18n
