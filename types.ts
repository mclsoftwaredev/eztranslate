
export interface Language {
  code: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'top' | 'bottom';
  timestamp: number;
}

export interface TranslationSessionState {
  isActive: boolean;
  isConnecting: boolean;
  lastError: string | null;
}
