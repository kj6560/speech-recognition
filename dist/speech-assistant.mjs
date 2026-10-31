import "../speech-assistant.js";

// Expose for ESM consumers.
export default globalThis.SpeechAssistant;

// Export the default messages object for consumers who need them.
export const DEFAULT_MESSAGES = globalThis.SpeechAssistant?.DEFAULT_MESSAGES || {};