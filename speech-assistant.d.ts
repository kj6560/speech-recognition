/**
 * Speech Assistant – dependency-free browser speech-assistant library.
 * 
 * Usage (script tag):
 *   <script src="speech-assistant.js"></script>
 *   const assistant = new SpeechAssistant({ endpoint: "/api" });
 *   assistant.start();
 * 
 * Usage (ESM / bundlers):
 *   import SpeechAssistant from "speech-assistant";
 *   const assistant = new SpeechAssistant({ endpoint: "/api" });
 * 
 * Usage (configure):
 *   assistant.configure({ rate: 1.2, messages: { thinking: "Working..." } });
 *   assistant.getOptions();
 */

declare global {
  interface Window {
    SpeechAssistant?: typeof SpeechAssistant;
    speechAssistant?: typeof SpeechAssistant;
  }
}

export type { DEFAULT_MESSAGES };

export interface SpeechAssistantOptions {
  /** URL that receives { message } and returns { reply }.
   *  Omit to use the built-in demo commands. */
  endpoint?: string | null;
  /** String or function returning a string/Promise, read before every request. */
  token?: string | ((() => string | Promise<string>) | null);
  /** Fully custom async handler. Overrides endpoint. */
  onCommand?: (({ command: string, transcript: string, assistant: SpeechAssistant }) => string | Promise<string>) | null;
  /** BCP-47 language tag for recognition and speech. */
  lang?: string;
  /** Keep recognition open; the library restarts it anyway. */
  continuous?: boolean;
  /** Emit interim events while the user is still talking. */
  interimResults?: boolean;
  /** ms to wait before listening again after speech ends. */
  restartDelay?: number;
  /** Speech synthesis rate (1 = normal). */
  rate?: number;
  /** Speech synthesis pitch (1 = normal). */
  pitch?: number;
  /** Speech synthesis volume (1 = normal). */
  volume?: number;
  /** Voice name, voiceURI, or SpeechSynthesisVoice object. */
  voice?: string | null;
  /** Passed to fetch; use "include" for cross-origin credentials. */
  credentials?: "same-origin" | "include";
  /** ms before the request is aborted. */
  requestTimeout?: number;
  /** Injection point for tests / alternative environments. */
  environment?: any;
  /** Default text for welcome() when called without an argument. */
  welcomeMessage?: string | null;
  /** Override any status line. Merged with SpeechAssistant.DEFAULT_MESSAGES. */
  messages?: Record<string, string>;
}

export class SpeechAssistant {
  constructor(options: SpeechAssistantOptions);

  /** Begin a conversation. Call from a user gesture. Returns true on success. */
  start(): boolean;
  /** End the conversation, cancel speech, abort any request. */
  stop(): void;
  /** Start the conversation by speaking first; falls back to listening if TTS is unavailable. */
  welcome(message?: string): boolean;
  /** Speak without listening. */
  speak(text: string): boolean;
  /** Feed text in as if it was spoken (text fallback, tests). */
  sendText(text: string): true;
  /** Run the built-in keyword routes (only when endpoint & onCommand are absent). */
  handleCommand(command: string): void;
  /** Get current state. */
  getState(): {
    conversationActive: boolean;
    listening: boolean;
    speaking: boolean;
    processing: boolean;
    status: string;
  };
  /** Capability check. */
  getSupport(): {
    recognition: boolean;
    synthesis: boolean;
    secureContext: boolean;
    microphone: boolean;
    canListen: boolean;
    canSpeak: boolean;
    supported: boolean;
    issues: string[];
    message: string;
  };
  /** Available synthesis voices. */
  getVoices(): SpeechSynthesisVoice[];
  /** Subscribe to events. */
  on<E extends keyof SpeechAssistantEvents>(
    event: E,
    listener: (detail: SpeechAssistantEvents[E]) => void
  ): () => void;
  /** Destroy and remove all listeners. */
  destroy(): void;
  /** Change any option at runtime. */
  configure(patch: Partial<SpeechAssistantOptions> & { messages?: Partial<Record<string, string>> }): this;
  /** Get the current, fully merged options. */
  getOptions(): SpeechAssistantOptions;
}

export interface SpeechAssistantEvents {
  status: { message: string };
  transcript: { command: string; transcript: string };
  interim: { text: string };
  response: { message: string };
  intent: { intent: string; pageName?: string; command: string; transcript?: string };
  speechend: { message: string; completed: boolean };
  state: {
    conversationActive: boolean;
    listening: boolean;
    speaking: boolean;
    processing: boolean;
    status: string;
  };
  error: { error: unknown; code: string };
}

export type { SpeechAssistantEvents };

export const DEFAULT_MESSAGES: Record<string, string>;