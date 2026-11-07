(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SpeechAssistant = factory();
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function isUnauthorized(error) {
        if (!error) return false;
        return (
            error.code === "unauthorized" ||
            error.status === 401 ||
            error.statusCode === 401 ||
            (error.response && error.response.status === 401)
        );
    }

    // Every user-facing status line lives here. Override any of them with the
    // `messages` option, or later with assistant.configure({ messages }).
    const DEFAULT_MESSAGES = {
        ready: "Ready",
        readyToChat: "Ready. Click the microphone or type a message.",
        listening: "Listening... Speak now",
        listeningAgain: "Listening for your next command...",
        thinking: "Thinking...",
        speaking: "Assistant speaking...",
        conversationEnded: "Conversation ended",
        signInRequired: "Please sign in to continue.",
        sessionExpired: "Your session expired. Please sign in again.",
        microphoneDenied: "Please allow microphone access.",
        noSpeech: "No speech detected. Listening again...",
        networkError: "Speech recognition network error.",
        recognitionError: "Recognition error",
        startRecognitionFailed: "Unable to start speech recognition",
        synthesisFailed: "Unable to speak",
        startToEnableSpeech: "Click Start Voice Assistant to enable speech.",
        requestFailed: "Something went wrong while handling your request.",
        apology: "Sorry, I could not process that request.",
        recognitionUnsupported: "Speech recognition is not supported in this browser.",
        synthesisUnsupported: "This browser cannot speak replies aloud.",
        insecureContext: "Voice needs a secure connection. Open this page over HTTPS or localhost.",
        noMediaDevices: "This browser does not expose microphone access.",
        supported: "Speech recognition and voice replies are available."
    };

    // Default UI configuration – each field can be overridden by passing
    // `config: { … }` to the constructor, or later with assistant.configure({ config: { … } }).
    const DEFAULT_CONFIG = {
        title: "👋 Welcome to AI Assistant",
        description:
            "Talk to me naturally, or type below. I can help you navigate the site, find customers, check inventory, view sales reports and answer your questions.",
        welcomeMessage:
            "Hello! Welcome to our website. I am your personal voice assistant. What would you like me to do for you today?",
        texts: {
            youSaid: "You said",
            assistant: "Assistant",
            trySaying: "Try saying",
            placeholder: "Or type your question…",
            send: "Send",
            start: "🔊 Start Voice Assistant",
            stop: "End Conversation",
            micLabel: "Start listening",
            byeTitle: "Goodbye!",
            byeText: "Thank you for interacting with us. Have a great day!"
        },
        suggestions: [
            "Open dashboard",
            "Show customers",
            "Show inventory",
            "Show sales report",
            "What can you do?",
            "Goodbye"
        ],
        demoCommands: [],
        fallbackReply:
            'I heard you say "{text}". I am not sure how to help with that yet. Could you please try another command?',
        theme: {
            bg: "#101827",
            panel: "#1c293b",
            "panel-dark": "#101827",
            text: "#ffffff",
            muted: "#bdc9d9",
            accent: "#4ade80",
            mic: "#16a34a",
            listening: "#dc2626",
            primary: "#2563eb",
            neutral: "#475569",
            border: "#2f415c",
            placeholder: "#7c8aa0",
            chip: "#ffffff0d",
            shadow: "#0005"
        },
        messages: {}
    };

    class SpeechAssistant {
        /**
         * Synchronous capability check. Safe to call before constructing an
         * instance, so a page can show the right UI immediately. Pass `messages`
         * to translate the returned description.
         */
        static checkSupport(environment = globalThis, messages = {}) {
            const text = { ...DEFAULT_MESSAGES, ...messages };
            const Recognition = environment.SpeechRecognition ||
                environment.webkitSpeechRecognition;

            const recognition = Boolean(Recognition);
            const synthesis = Boolean(
                environment.speechSynthesis &&
                environment.SpeechSynthesisUtterance
            );
            // Only an explicit `false` means insecure. Fake/partial environments
            // (e.g. tests) leave it undefined and are not blocked.
            const secureContext = environment.isSecureContext !== false;
            const microphone = Boolean(
                environment.navigator && environment.navigator.mediaDevices
            );

            const issues = [];
            if (!recognition) issues.push("recognition-unsupported");
            if (!synthesis) issues.push("synthesis-unsupported");
            if (!secureContext) issues.push("insecure-context");
            if (!microphone) issues.push("no-media-devices");

            const canListen = recognition && secureContext;
            const canSpeak = synthesis;
            const supported = canListen && canSpeak;

            let message;
            if (!secureContext) {
                message = text.insecureContext;
            } else if (!recognition) {
                message = text.recognitionUnsupported;
            } else if (!synthesis) {
                message = text.synthesisUnsupported;
            } else if (!microphone) {
                message = text.noMediaDevices;
            } else {
                message = text.supported;
            }

            return {
                recognition,
                synthesis,
                secureContext,
                microphone,
                canListen,
                canSpeak,
                supported,
                issues,
                message
            };
        }

        constructor(options = {}) {
            if (!options || typeof options !== "object") {
                throw new TypeError("Options must be an object.");
            }

            this.options = {
                lang: options.lang || "en-IN",
                continuous: options.continuous ?? false,
                interimResults: options.interimResults ?? false,
                restartDelay: options.restartDelay ?? 700,
                rate: options.rate ?? 1,
                pitch: options.pitch ?? 1,
                volume: options.volume ?? 1,
                voice: options.voice ?? null,
                onCommand: options.onCommand ?? null,
                endpoint: options.endpoint ?? null,
                token: options.token ?? null,
                credentials: options.credentials || "same-origin",
                requestTimeout: options.requestTimeout ?? 15000,
                welcomeMessage: options.welcomeMessage ?? null,
                messages: { ...DEFAULT_MESSAGES, ...(options.messages || {}) },
                config: options.config ? { ...DEFAULT_CONFIG, ...options.config } : DEFAULT_CONFIG
            };

            this._validateOptions(this.options);

            this.environment = options.environment || globalThis;
            this.listeners = new Map();
            this.conversationActive = false;
            this.recognitionRunning = false;
            this.recognitionStarting = false;
            this.assistantSpeaking = false;
            this.status = this.options.messages.ready;
            this.restartTimer = null;
            this.requestTimer = null;
            this.requestController = null;
            this.currentSpeech = null;
            this.speechToken = 0;
            this.commandToken = 0;
            this.processing = false;
            this.destroyed = false;

            const Recognition = this.environment.SpeechRecognition ||
                this.environment.webkitSpeechRecognition;
            this.recognition = Recognition ? new Recognition() : null;

            if (this.recognition) {
                this.recognition.lang = this.options.lang;
                this.recognition.continuous = this.options.continuous;
                this.recognition.interimResults = this.options.interimResults;
                this.recognition.onstart = () => this._onRecognitionStart();
                this.recognition.onresult = (event) => this._onRecognitionResult(event);
                this.recognition.onend = () => this._onRecognitionEnd();
                this.recognition.onerror = (event) => this._onRecognitionError(event);
            }
        }

        /**
         * Change any option at runtime. `config` is merged, so you can update
         * one UI setting without restating the whole object.
         */
        configure(patch = {}) {
            if (!patch || typeof patch !== "object") {
                throw new TypeError("configure() expects an object.");
            }

            // Merge config subsection
            if (patch.config) {
                this.options.config = {
                    ...this.options.config,
                    ...patch.config
                };
                // Keep aliases in sync
                this.options.welcomeMessage =
                    this.options.config.welcomeMessage;
                this.options.texts = {
                    ...this.options.config.texts,
                    ...patch.config.texts
                };
                this.options.theme = {
                    ...this.options.config.theme,
                    ...patch.config.theme
                };
                this.options.messages = {
                    ...this.options.config.messages,
                    ...patch.config.messages
                };
            }

            // Merge top‑level options (lang, rate, etc.) – reuse existing logic
            if (patch.lang !== undefined) {
                this.options.lang = patch.lang;
                if (this.recognition) this.recognition.lang = patch.lang;
            }
            if (patch.continuous !== undefined) {
                this.options.continuous = patch.continuous;
                if (this.recognition) this.recognition.continuous = patch.continuous;
            }
            if (patch.interimResults !== undefined) {
                this.options.interimResults = patch.interimResults;
                if (this.recognition) this.recognition.interimResults = patch.interimResults;
            }
            if (patch.restartDelay !== undefined) {
                this.options.restartDelay = patch.restartDelay;
            }
            if (patch.rate !== undefined) this.options.rate = patch.rate;
            if (patch.pitch !== undefined) this.options.pitch = patch.pitch;
            if (patch.volume !== undefined) this.options.volume = patch.volume;
            if (patch.voice !== undefined) this.options.voice = patch.voice;
            if (patch.endpoint !== undefined) this.options.endpoint = patch.endpoint;
            if (patch.token !== undefined) this.options.token = patch.token;
            if (patch.credentials !== undefined) this.options.credentials = patch.credentials;
            if (patch.requestTimeout !== undefined) this.options.requestTimeout = patch.requestTimeout;
            if (patch.welcomeMessage !== undefined)
                this.options.welcomeMessage = patch.welcomeMessage;
            if (patch.messages !== undefined)
                this.options.messages = {
                    ...this.options.messages,
                    ...patch.messages
                };

            _validateOptions(this.options);

            return this.getOptions();
        }

        getOptions() {
            return {
                ...this.options,
                config: { ...this.options.config },
                messages: { ...this.options.messages }
            };
        }

        _validateOptions(options) {
            if (options.onCommand !== null &&
                typeof options.onCommand !== "function") {
                throw new TypeError("onCommand must be a function.");
            }
            if (options.token !== null &&
                typeof options.token !== "string" &&
                typeof options.token !== "function") {
                throw new TypeError("token must be a string or a function.");
            }
            if (options.endpoint !== null &&
                typeof options.endpoint !== "string") {
                throw new TypeError("endpoint must be a string.");
            }
            if (options.welcomeMessage !== null &&
                (typeof options.welcomeMessage !== "string" ||
                    !options.welcomeMessage.trim())) {
                throw new TypeError("welcomeMessage must be a non-empty string or null.");
            }
            if (typeof options.messages !== "object" || options.messages === null) {
                throw new TypeError("messages must be an object.");
            }
            if (typeof options.lang !== "string" || !options.lang.trim()) {
                throw new TypeError("lang must be a non-empty string.");
            }
            if (typeof options.restartDelay !== "number" || options.restartDelay < 0) {
                throw new TypeError("restartDelay must be a positive number.");
            }
            if (typeof options.requestTimeout !== "number" || options.requestTimeout < 0) {
                throw new TypeError("requestTimeout must be a positive number.");
            }
            if (typeof options.rate !== "number" ||
                typeof options.pitch !== "number" ||
                typeof options.volume !== "number") {
                throw new TypeError("rate, pitch and volume must be numbers.");
            }
            return this;
        }

        /**
         * Change any option at runtime. Messages are merged, so you can update
         * one status line without restating the rest.
         */
        configure(patch = {}) {
            if (!patch || typeof patch !== "object") {
                throw new TypeError("configure() expects an object.");
            }

            const next = { ...this.options, ...patch };
            if (patch.messages) {
                next.messages = { ...this.options.messages, ...patch.messages };
            }

            this._validateOptions(next);
            this.options = next;

            if (this.recognition) {
                this.recognition.lang = next.lang;
                this.recognition.continuous = next.continuous;
                this.recognition.interimResults = next.interimResults;
            }

            return this.getOptions();
        }

        getOptions() {
            return {
                ...this.options,
                messages: { ...this.options.messages }
            };
        }

        on(eventName, listener) {
            if (typeof listener !== "function") {
                throw new TypeError("Listener must be a function.");
            }

            const listeners = this.listeners.get(eventName) || new Set();
            listeners.add(listener);
            this.listeners.set(eventName, listeners);

            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) this.listeners.delete(eventName);
            };
        }

        getSupport() {
            return SpeechAssistant.checkSupport(this.environment);
        }

        getState() {
            return {
                conversationActive: this.conversationActive,
                listening: this.recognitionRunning,
                speaking: this.assistantSpeaking,
                processing: this.processing,
                status: this.status
            };
        }

        getVoices() {
            const synth = this.environment.speechSynthesis;
            return synth && typeof synth.getVoices === "function"
                ? synth.getVoices()
                : [];
        }

        _resolveVoice() {
            const wanted = this.options.voice;
            if (!wanted) return null;
            if (typeof wanted === "object") return wanted;

            return this.getVoices().find((voice) =>
                voice.name === wanted || voice.voiceURI === wanted
            ) || null;
        }

        welcome(message = this.options.welcomeMessage) {
            if (typeof message !== "string" || !message.trim()) {
                throw new TypeError(
                    "Welcome message must be a non-empty string. Pass one to " +
                    "welcome() or set the welcomeMessage option."
                );
            }
            this.conversationActive = true;
            this._emit("state", this.getState());

            const spoken = this.speak(message);

            // If text-to-speech is unavailable, don't leave the user stranded:
            // start listening so the conversation can still happen.
            if (!spoken) this._startListening();

            return spoken;
        }

        start() {
            if (this.destroyed) {
                throw new Error("This speech assistant has been destroyed.");
            }
            if (!this.recognition) {
                this._setStatus(this.options.messages.recognitionUnsupported);
                this._emit("error", {
                    error: new Error("Speech recognition is not supported in this browser."),
                    code: "unsupported-recognition"
                });
                return false;
            }
            if (this.environment.isSecureContext === false) {
                this._setStatus(this.options.messages.insecureContext);
                this._emit("error", {
                    error: new Error("Voice requires a secure context."),
                    code: "insecure-context"
                });
                return false;
            }

            this._clearRestartTimer();
            this.commandToken += 1;
            this.processing = false;
            this.conversationActive = true;
            this._emit("state", this.getState());

            if (this.assistantSpeaking) this._cancelSpeech();
            this._startListening();
            return true;
        }

        stop() {
            this.conversationActive = false;
            this.commandToken += 1;
            this.processing = false;
            this._clearRestartTimer();
            this._abortRequest();

            if (this.recognition && (this.recognitionRunning || this.recognitionStarting)) {
                try {
                    this.recognition.stop();
                } catch (error) {
                    this._emit("error", { error, code: "recognition-stop" });
                }
            }

            this.recognitionRunning = false;
            this.recognitionStarting = false;
            this._cancelSpeech();
            this._setStatus(this.options.messages.conversationEnded);
            this._emit("state", this.getState());
        }

        speak(message) {
            if (typeof message !== "string" || !message.trim()) {
                throw new TypeError("Speech message must be a non-empty string.");
            }

            const { speechSynthesis, SpeechSynthesisUtterance } = this.environment;
            if (!speechSynthesis || !SpeechSynthesisUtterance) {
                this._setStatus(this.options.messages.synthesisUnsupported);
                this._emit("error", {
                    error: new Error("Text-to-speech is not supported in this browser."),
                    code: "unsupported-synthesis"
                });
                return false;
            }

            this._clearRestartTimer();
            this._invalidateSpeech();
            this.assistantSpeaking = true;
            this._setStatus(this.options.messages.speaking);
            this._emit("response", { message });
            this._emit("state", this.getState());

            if (this.recognitionRunning || this.recognitionStarting) {
                try {
                    this.recognition.stop();
                } catch (error) {
                    this._emit("error", { error, code: "recognition-stop" });
                }
            }

            try {
                speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(message);
                const token = this.speechToken;
                utterance.lang = this.options.lang;
                utterance.rate = this.options.rate;
                utterance.pitch = this.options.pitch;
                utterance.volume = this.options.volume;

                const voice = this._resolveVoice();
                if (voice) utterance.voice = voice;
                utterance.onstart = () => {
                    if (token !== this.speechToken) return;
                    this.assistantSpeaking = true;
                    this._setStatus(this.options.messages.speaking);
                    this._emit("state", this.getState());
                };
                utterance.onend = () => {
                    if (token !== this.speechToken) return;
                    this.currentSpeech = null;
                    this.assistantSpeaking = false;
                    this._emit("speechend", { message, completed: true });
                    this._setStatus(
                        this.conversationActive
                            ? this.options.messages.listeningAgain
                            : this.options.messages.ready
                    );
                    this._emit("state", this.getState());
                    if (this.conversationActive) this._scheduleListening();
                };
                utterance.onerror = (event) => {
                    if (token !== this.speechToken) return;
                    this.currentSpeech = null;
                    this.assistantSpeaking = false;
                    this._emit("speechend", { message, completed: false });
                    this._emit("error", {
                        error: event,
                        code: event.error || "synthesis-error"
                    });
                    if (event.error === "not-allowed") {
                        this.conversationActive = false;
                        this._setStatus(this.options.messages.startToEnableSpeech);
                    } else if (this.conversationActive) {
                        this._scheduleListening();
                    }
                    this._emit("state", this.getState());
                };

                this.currentSpeech = utterance;
                speechSynthesis.speak(utterance);
                return true;
            } catch (error) {
                this.assistantSpeaking = false;
                this._emit("error", { error, code: "synthesis-failed" });
                this._setStatus(
                    this.options.messages.synthesisFailed + ": " + error.message
                );
                this._emit("state", this.getState());
                return false;
            }
        }

        handleCommand(command) {
            if (typeof command !== "string" || !command.trim()) {
                throw new TypeError("Command must be a non-empty string.");
            }

            const normalized = command.trim().toLowerCase();
            const routes = [
                ["dashboard", "Opening your dashboard.", "Dashboard"],
                ["customer", "Sure! Let me show you the customers section.", "Customers"],
                ["inventory", "Opening inventory management.", "Inventory"],
                ["sales", "Opening your sales report.", "Sales Report"]
            ];
            const route = routes.find(([keyword]) => normalized.includes(keyword));

            if (route) {
                const [, message, pageName] = route;
                this._emit("intent", {
                    intent: pageName.toLowerCase().replaceAll(" ", "-"),
                    pageName,
                    command: normalized
                });
                this.speak(message);
            } else if (
                normalized.includes("what can you do") ||
                normalized.includes("help")
            ) {
                this.speak(
                    "I can help you navigate the dashboard, view customers, " +
                    "manage inventory and check sales reports. What would you like to do?"
                );
            } else if (normalized.includes("hello") || normalized.includes("hi")) {
                this.speak("Hello! How can I help you?");
            } else if (
                normalized.includes("thank you") ||
                normalized.includes("thanks")
            ) {
                this.speak("You're welcome! Anything else I can help you with?");
            } else if (
                normalized.includes("goodbye") ||
                normalized.includes("bye")
            ) {
                this._emit("intent", {
                    intent: "goodbye",
                    command: normalized
                });
                this.stop();
                this.speak("Goodbye! Have a great day.");
            } else {
                this.speak(
                    "I heard you say " + normalized +
                    ". I am not sure how to help with that yet. " +
                    "Could you please try another command?"
                );
            }
        }

        destroy() {
            this.stop();
            this.destroyed = true;
            this.listeners.clear();
            if (this.recognition) {
                this.recognition.onstart = null;
                this.recognition.onresult = null;
                this.recognition.onend = null;
                this.recognition.onerror = null;
            }
        }

        _startListening() {
            if (
                !this.conversationActive ||
                !this.recognition ||
                this.recognitionRunning ||
                this.recognitionStarting ||
                this.assistantSpeaking ||
                this.processing
            ) return;

            this.recognitionStarting = true;
            try {
                this.recognition.start();
            } catch (error) {
                this.recognitionStarting = false;
                this._emit("error", { error, code: "recognition-start" });
                this._setStatus(
                    this.options.messages.startRecognitionFailed + ": " + error.message
                );
            }
        }

        _scheduleListening() {
            if (!this.recognition) {
                this._setStatus(this.options.messages.recognitionUnsupported);
                return;
            }
            this._clearRestartTimer();
            this.restartTimer = this.environment.setTimeout(() => {
                this.restartTimer = null;
                if (this.conversationActive && !this.assistantSpeaking && !this.processing) {
                    this._startListening();
                }
            }, this.options.restartDelay);
        }

        _clearRestartTimer() {
            if (this.restartTimer !== null) {
                this.environment.clearTimeout(this.restartTimer);
                this.restartTimer = null;
            }
        }

        _abortRequest() {
            if (this.requestTimer !== null) {
                this.environment.clearTimeout(this.requestTimer);
                this.requestTimer = null;
            }
            if (this.requestController) {
                try {
                    this.requestController.abort();
                } catch (error) {
                    // Ignore: the request is being discarded anyway.
                }
                this.requestController = null;
            }
        }

        _onRecognitionStart() {
            this.recognitionStarting = false;
            this.recognitionRunning = true;
            this._setStatus(this.options.messages.listening);
            this._emit("state", this.getState());
        }

        _onRecognitionResult(event) {
            const results = event.results;
            if (!results) return;

            const result = results[event.resultIndex || 0];
            const transcript = result && result[0] && result[0].transcript;
            if (typeof transcript !== "string" || !transcript.trim()) return;

            const text = transcript.trim();

            // Interim results are previews; never act on them.
            if (result.isFinal === false) {
                this._emit("interim", { text });
                return;
            }

            this._handleText(text);
        }

        // Feed text in directly, e.g. from a text box when the mic is unavailable.
        sendText(text) {
            if (typeof text !== "string" || !text.trim()) {
                throw new TypeError("Text must be a non-empty string.");
            }
            this._handleText(text.trim());
            return true;
        }

        _handleText(text) {
            const command = text.toLowerCase();
            this._emit("transcript", { command, transcript: text });

            if (this.options.onCommand || this.options.endpoint) {
                this._runCommandHandler(command, text);
            } else {
                this.handleCommand(text);
            }
        }

        async _runCommandHandler(command, transcript) {
            const commandToken = ++this.commandToken;
            this.processing = true;
            this._clearRestartTimer();
            this._setStatus(this.options.messages.thinking);
            this._emit("state", this.getState());

            if (this.recognitionRunning || this.recognitionStarting) {
                try {
                    this.recognition.stop();
                } catch (error) {
                    this._emit("error", { error, code: "recognition-stop" });
                }
            }

            let reply;
            try {
                reply = await this._resolveReply(command, transcript);
            } catch (error) {
                if (commandToken !== this.commandToken) return;
                this.processing = false;

                // 401 means the session is no longer valid: stop everything and
                // let the host app send the user back to login. Permission
                // denials should be normal replies, not 401s.
                if (isUnauthorized(error)) {
                    this._emit("error", { error, code: "unauthorized" });
                    this.stop();
                    this._setStatus(this.options.messages.sessionExpired);
                    return;
                }

                this._emit("error", { error, code: "command-handler" });
                this._setStatus(this.options.messages.requestFailed);
                this._emit("state", this.getState());
                if (this.conversationActive) {
                    this.speak(this.options.messages.apology);
                }
                return;
            }

            // A stop(), start(), or newer command invalidated this reply.
            if (commandToken !== this.commandToken) return;
            this.processing = false;

            if (reply && typeof reply === "object" &&
                typeof reply.intent === "string") {
                this._emit("intent", { intent: reply.intent, command, transcript });
            }

            const message = typeof reply === "string"
                ? reply
                : (reply && typeof reply.message === "string"
                    ? reply.message
                    : (reply && typeof reply.reply === "string" ? reply.reply : ""));

            if (!message.trim()) {
                this._setStatus(
                    this.conversationActive
                        ? this.options.messages.listeningAgain
                        : this.options.messages.ready
                );
                this._emit("state", this.getState());
                if (this.conversationActive) this._scheduleListening();
                return;
            }

            this.speak(message);
        }

        _resolveReply(command, transcript) {
            if (this.options.onCommand) {
                return this.options.onCommand({ command, transcript, assistant: this });
            }
            return this._request(transcript);
        }

        async _request(transcript) {
            const fetchFn = this.environment.fetch;
            if (typeof fetchFn !== "function") {
                throw new Error("fetch is not available in this environment.");
            }

            const AbortControllerImpl = this.environment.AbortController;
            const controller = AbortControllerImpl ? new AbortControllerImpl() : null;

            if (controller) {
                this.requestController = controller;
                this.requestTimer = this.environment.setTimeout(
                    () => controller.abort(),
                    this.options.requestTimeout
                );
            }

            try {
                const headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                };

                const token = typeof this.options.token === "function"
                    ? await this.options.token()
                    : this.options.token;

                if (typeof token === "string" && token.trim()) {
                    headers.Authorization = "Bearer " + token.trim();
                }

                const response = await fetchFn(this.options.endpoint, {
                    method: "POST",
                    headers,
                    credentials: this.options.credentials,
                    body: JSON.stringify({ message: transcript }),
                    ...(controller ? { signal: controller.signal } : {})
                });

                if (response.status === 401) {
                    const error = new Error("Unauthorized");
                    error.status = 401;
                    throw error;
                }

                if (response.status === 403) {
                    // Let the server explain the refusal in its own words.
                    const data = await this._readBody(response);
                    if (data && typeof data.reply === "string" && data.reply.trim()) {
                        return data.reply;
                    }
                    const error = new Error("Forbidden");
                    error.status = 403;
                    throw error;
                }

                if (!response.ok) {
                    const error = new Error("Assistant API failed: " + response.status);
                    error.status = response.status;
                    throw error;
                }

                const data = await this._readBody(response);

                if (typeof data === "string") return data;

                if (data && (typeof data.reply === "string" ||
                    typeof data.intent === "string")) {
                    return { reply: data.reply, intent: data.intent };
                }

                return "";
            } finally {
                if (this.requestTimer !== null) {
                    this.environment.clearTimeout(this.requestTimer);
                    this.requestTimer = null;
                }
                if (this.requestController === controller) {
                    this.requestController = null;
                }
            }
        }

        async _readBody(response) {
            const contentType = response.headers &&
                typeof response.headers.get === "function"
                ? response.headers.get("content-type") || ""
                : "";

            if (contentType.includes("json")) return response.json();

            const text = typeof response.text === "function"
                ? await response.text()
                : "";

            if (!text) return null;

            try {
                return JSON.parse(text);
            } catch (error) {
                return text;
            }
        }

        _onRecognitionEnd() {
            this.recognitionRunning = false;
            this.recognitionStarting = false;
            this._emit("state", this.getState());
            if (this.conversationActive && !this.assistantSpeaking && !this.processing) {
                this._scheduleListening();
            }
        }

        _onRecognitionError(event) {
            this.recognitionRunning = false;
            this.recognitionStarting = false;
            this._emit("error", {
                error: event,
                code: event.error || "recognition-error"
            });

            if (
                event.error === "not-allowed" ||
                event.error === "service-not-allowed"
            ) {
                this.stop();
                this._setStatus(this.options.messages.microphoneDenied);
            } else if (event.error === "network") {
                this._setStatus(this.options.messages.networkError);
            } else if (event.error === "no-speech") {
                this._setStatus(this.options.messages.noSpeech);
            } else {
                this._setStatus(
                    this.options.messages.recognitionError + ": " + event.error
                );
            }
        }

        _cancelSpeech() {
            this._invalidateSpeech();
            if (this.environment.speechSynthesis) {
                try {
                    this.environment.speechSynthesis.cancel();
                } catch (error) {
                    this._emit("error", { error, code: "synthesis-cancel" });
                }
            }
            this.assistantSpeaking = false;
        }

        _invalidateSpeech() {
            this.speechToken += 1;
            this.currentSpeech = null;
        }

        _setStatus(message) {
            this.status = message;
            this._emit("status", { message });
        }

        _emit(eventName, detail) {
            const listeners = this.listeners.get(eventName);
            if (listeners) {
                for (const listener of [...listeners]) listener(detail);
            }
        }
    }

    SpeechAssistant.DEFAULT_MESSAGES = Object.freeze({ ...DEFAULT_MESSAGES });

    return SpeechAssistant;
}));
