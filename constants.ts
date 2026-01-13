
import { Language } from './types';

export const LANGUAGES: Language[] = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'zh-CN', name: 'Chinese (Mandarin)' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'pt-BR', name: 'Portuguese' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'ar-SA', name: 'Arabic' },
  { code: 'hi-IN', name: 'Hindi' },
  { code: 'bn-BD', name: 'Bengali' },
  { code: 'tr-TR', name: 'Turkish' },
  { code: 'vi-VN', name: 'Vietnamese' },
  { code: 'pl-PL', name: 'Polish' },
  { code: 'nl-NL', name: 'Dutch' },
  { code: 'th-TH', name: 'Thai' },
  { code: 'el-GR', name: 'Greek' },
  { code: 'he-IL', name: 'Hebrew' }
];

export const DEFAULT_TOP_LANG = LANGUAGES[0]; // English
export const DEFAULT_BOTTOM_LANG = LANGUAGES[1]; // Spanish
