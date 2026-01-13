
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LANGUAGES, DEFAULT_TOP_LANG, DEFAULT_BOTTOM_LANG } from './constants';
import { ChatMessage, Language } from './types';

// Helper functions for audio processing
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [topLang, setTopLang] = useState<Language>(DEFAULT_TOP_LANG);
  const [bottomLang, setBottomLang] = useState<Language>(DEFAULT_BOTTOM_LANG);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Audio Contexts & Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Transcription buffer
  const currentOutputTranscriptionRef = useRef('');

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close?.();
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsLive(false);
    setIsConnecting(false);
  }, []);

  const startSession = async () => {
    if (isLive || isConnecting) return;
    setIsConnecting(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      if (!inputAudioContextRef.current) {
        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const systemInstruction = `You are a real-time translator for two people sitting face-to-face.
      - The person on the TOP of the screen speaks ${topLang.name}.
      - The person on the BOTTOM of the screen speaks ${bottomLang.name}.
      
      RULES:
      1. Detect who is speaking.
      2. If you hear ${topLang.name}, translate it into ${bottomLang.name} and START your text response with "[FOR_BOTTOM]".
      3. If you hear ${bottomLang.name}, translate it into ${topLang.name} and START your text response with "[FOR_TOP]".
      4. Only output the translation. No conversational filler or explanations.
      5. The audio you produce is the spoken translation. It will be played to the listener.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction,
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setIsConnecting(false);

            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Audio Output (The translation audio)
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            // Transcription (The translation text)
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const fullText = currentOutputTranscriptionRef.current.trim();
              if (fullText) {
                let target: 'top' | 'bottom' = 'bottom';
                let cleanedText = fullText;
                
                if (fullText.startsWith('[FOR_TOP]')) {
                  target = 'top'; // This is for the person at the top
                  cleanedText = fullText.replace('[FOR_TOP]', '').trim();
                } else if (fullText.startsWith('[FOR_BOTTOM]')) {
                  target = 'bottom'; // This is for the person at the bottom
                  cleanedText = fullText.replace('[FOR_BOTTOM]', '').trim();
                }

                setMessages(prev => [{
                  id: Math.random().toString(36).substring(7),
                  text: cleanedText,
                  sender: target,
                  timestamp: Date.now()
                }, ...prev]);
              }
              currentOutputTranscriptionRef.current = '';
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (err) => {
            console.error('Session error:', err);
            stopSession();
          },
          onclose: () => {
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start session:', err);
      setIsConnecting(false);
      setIsLive(false);
    }
  };

  useEffect(() => {
    if (isLive) {
      stopSession();
      const timer = setTimeout(startSession, 500);
      return () => clearTimeout(timer);
    }
  }, [topLang.code, bottomLang.code]);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-900 text-white overflow-hidden relative">
      
      {/* Top Half (Upside Down) */}
      <div className="h-1/2 rotate-180 p-6 border-b border-slate-700 flex flex-col gap-4 bg-slate-800/40 relative">
        <div className="flex items-center justify-between shrink-0">
          <select 
            value={topLang.code}
            onChange={(e) => setTopLang(LANGUAGES.find(l => l.code === e.target.value) || DEFAULT_TOP_LANG)}
            className="bg-slate-700 text-white px-3 py-2 rounded-lg outline-none border border-slate-600 focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium z-20"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Opponent View</span>
          </div>
        </div>
        
        {/* Scrollable text area for Top person */}
        <div className="flex-1 bg-slate-950/60 rounded-xl p-5 overflow-y-auto border border-slate-700/50 shadow-inner flex flex-col-reverse scrollbar-thin scrollbar-thumb-slate-700">
          {messages.filter(m => m.sender === 'top').map((msg) => (
            <div key={msg.id} className="mb-5 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <p className="text-xl md:text-2xl font-light leading-snug text-blue-100">{msg.text}</p>
              <div className="h-px w-12 bg-blue-500/30 mt-3"></div>
            </div>
          ))}
          {messages.filter(m => m.sender === 'top').length === 0 && (
            <div className="h-full flex items-center justify-center opacity-20 text-center">
              <p className="text-lg italic">Speak on the bottom to see translation here</p>
            </div>
          )}
        </div>
      </div>

      {/* Persistent Divider Line & Control Button */}
      <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-600/50 z-10 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto">
          {!isLive ? (
            <button 
              onClick={startSession}
              disabled={isConnecting}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold py-4 px-10 rounded-full shadow-2xl transition-all flex items-center gap-3 transform hover:scale-110 active:scale-95 border-4 border-slate-900"
            >
              {isConnecting ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
              {isConnecting ? 'Connecting...' : 'Start Translator'}
            </button>
          ) : (
            <button 
              onClick={stopSession}
              className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-8 rounded-full shadow-2xl transition-all flex items-center gap-3 transform hover:scale-105 active:scale-95 border-4 border-slate-900"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Bottom Half (Normal) */}
      <div className="h-1/2 p-6 flex flex-col gap-4 bg-slate-900 relative">
        <div className="flex items-center justify-between shrink-0">
          <select 
            value={bottomLang.code}
            onChange={(e) => setBottomLang(LANGUAGES.find(l => l.code === e.target.value) || DEFAULT_BOTTOM_LANG)}
            className="bg-slate-800 text-white px-3 py-2 rounded-lg outline-none border border-slate-700 focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium z-20"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
             <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Your View</span>
          </div>
        </div>

        {/* Scrollable text area for Bottom person */}
        <div className="flex-1 bg-slate-950/60 rounded-xl p-5 overflow-y-auto border border-slate-800/50 shadow-inner flex flex-col-reverse scrollbar-thin scrollbar-thumb-slate-800">
          {messages.filter(m => m.sender === 'bottom').map((msg) => (
            <div key={msg.id} className="mb-5 animate-in fade-in slide-in-from-top-3 duration-500">
              <p className="text-xl md:text-2xl font-light leading-snug text-green-100">{msg.text}</p>
              <div className="h-px w-12 bg-green-500/30 mt-3"></div>
            </div>
          ))}
          {messages.filter(m => m.sender === 'bottom').length === 0 && (
            <div className="h-full flex items-center justify-center opacity-20 text-center">
              <p className="text-lg italic">Speak on the top to see translation here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
