const assert = require("node:assert/strict");
const test = require("node:test");
const SpeechAssistant = require("./speech-assistant.js");

class FakeRecognition {
    startCount = 0;
    stopCount = 0;

    start() {
        this.startCount += 1;
        this.onstart();
    }

    stop() {
        this.stopCount += 1;
        this.onend();
    }
}

class FakeUtterance {
    constructor(text) {
        this.text = text;
    }
}

function createEnvironment({ recognition = true } = {}) {
    const timers = new Map();
    let timerId = 0;
    const environment = {
        SpeechSynthesisUtterance: FakeUtterance,
        speechSynthesis: {
            utterances: [],
            cancelCount: 0,
            cancel() {
                this.cancelCount += 1;
            },
            speak(utterance) {
                this.utterances.push(utterance);
            }
        },
        setTimeout(callback) {
            const id = ++timerId;
            timers.set(id, callback);
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        runTimers() {
            const pending = [...timers.values()];
            timers.clear();
            pending.forEach((callback) => callback());
        }
    };

    if (recognition) environment.SpeechRecognition = FakeRecognition;
    return environment;
}

test("starts listening, interprets a command, and resumes after speaking", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment, restartDelay: 10 });
    const intents = [];
    const transcripts = [];
    assistant.on("intent", (intent) => intents.push(intent));
    assistant.on("transcript", (transcript) => transcripts.push(transcript));

    assert.equal(assistant.start(), true);
    assert.equal(assistant.recognition.startCount, 1);
    assert.equal(assistant.getState().listening, true);

    assistant.recognition.onresult({
        resultIndex: 0,
        results: [[{ transcript: "Open dashboard" }]]
    });

    assert.deepEqual(transcripts, [{ command: "open dashboard", transcript: "Open dashboard" }]);
    assert.equal(intents[0].intent, "dashboard");
    const utterance = environment.speechSynthesis.utterances[0];
    assert.equal(utterance.text, "Opening your dashboard.");
    assert.equal(assistant.getState().speaking, true);

    utterance.onend();
    assert.equal(assistant.getState().speaking, false);
    environment.runTimers();
    assert.equal(assistant.recognition.startCount, 2);

    assistant.stop();
    assert.equal(assistant.getState().conversationActive, false);
    assert.equal(assistant.getState().listening, false);
});

test("reports unsupported speech recognition without starting a conversation", () => {
    const assistant = new SpeechAssistant({ environment: createEnvironment({ recognition: false }) });
    const errors = [];
    assistant.on("error", (detail) => errors.push(detail.code));

    assert.equal(assistant.start(), false);
    assert.deepEqual(errors, ["unsupported-recognition"]);
    assert.equal(assistant.getState().conversationActive, false);
});

test("emits goodbye intent and finishes the farewell after stopping the conversation", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment });
    const intents = [];
    const speechEnds = [];
    assistant.on("intent", (intent) => intents.push(intent));
    assistant.on("speechend", (event) => speechEnds.push(event));
    assistant.start();

    assistant.handleCommand("goodbye");

    assert.equal(intents[0].intent, "goodbye");
    assert.equal(assistant.getState().conversationActive, false);
    const farewell = environment.speechSynthesis.utterances[0];
    assert.equal(farewell.text, "Goodbye! Have a great day.");
    farewell.onend();
    assert.deepEqual(speechEnds, [{
        message: "Goodbye! Have a great day.",
        completed: true
    }]);
});

test("awaits an async onCommand handler and speaks its reply instead of the built-in routes", async () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment, restartDelay: 10 });
    const calls = [];

    let resolveReply;
    const reply = new Promise((resolve) => { resolveReply = resolve; });

    assistant.options.onCommand = ({ command, transcript }) => {
        calls.push({ command, transcript });
        return reply;
    };

    assistant.start();
    assistant.recognition.onresult({
        resultIndex: 0,
        results: [[{ transcript: "How many customers signed up today?" }]]
    });

    assert.deepEqual(calls, [{
        command: "how many customers signed up today?",
        transcript: "How many customers signed up today?"
    }]);

    // Listening is paused while the backend is working.
    assert.equal(assistant.getState().processing, true);
    assert.equal(assistant.getState().listening, false);
    assert.equal(environment.speechSynthesis.utterances.length, 0);

    resolveReply("Twelve customers signed up today.");
    await reply;
    await Promise.resolve();
    await Promise.resolve();

    const utterance = environment.speechSynthesis.utterances[0];
    assert.equal(utterance.text, "Twelve customers signed up today.");
    assert.equal(assistant.getState().processing, false);
    assert.equal(assistant.getState().speaking, true);

    utterance.onend();
    environment.runTimers();
    assert.equal(assistant.recognition.startCount, 2);
});

test("handler returning nothing resumes listening without speaking", async () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment, restartDelay: 10 });
    assistant.options.onCommand = async () => null;

    assistant.start();
    assistant.recognition.onresult({ resultIndex: 0, results: [[{ transcript: "um" }]] });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(environment.speechSynthesis.utterances.length, 0);
    assert.equal(assistant.getState().processing, false);
    environment.runTimers();
    assert.equal(assistant.recognition.startCount, 2);
});

test("a handler reply arriving after stop() is discarded", async () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment });
    let resolveReply;
    assistant.options.onCommand = () => new Promise((resolve) => { resolveReply = resolve; });

    assistant.start();
    assistant.recognition.onresult({ resultIndex: 0, results: [[{ transcript: "hello" }]] });
    assistant.stop();

    resolveReply("This should never be spoken.");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(environment.speechSynthesis.utterances.length, 0);
});

test("a failing handler emits command-handler and keeps the conversation alive", async () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment, restartDelay: 10 });
    const errors = [];
    assistant.on("error", ({ code }) => errors.push(code));
    assistant.options.onCommand = async () => { throw new Error("network down"); };

    assistant.start();
    assistant.recognition.onresult({ resultIndex: 0, results: [[{ transcript: "hello" }]] });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(errors, ["command-handler"]);
    assert.equal(assistant.getState().processing, false);
    const utterance = environment.speechSynthesis.utterances[0];
    assert.equal(utterance.text, "Sorry, I could not process that request.");
    utterance.onend();
    environment.runTimers();
    assert.equal(assistant.recognition.startCount, 2);
});

test("checkSupport reports a fully capable environment", () => {
    const environment = createEnvironment();
    environment.navigator = { mediaDevices: {} };

    const support = SpeechAssistant.checkSupport(environment);

    assert.equal(support.supported, true);
    assert.equal(support.canListen, true);
    assert.equal(support.canSpeak, true);
    assert.deepEqual(support.issues, []);
    assert.match(support.message, /available/i);
});

test("checkSupport flags a browser without speech recognition", () => {
    const environment = createEnvironment({ recognition: false });
    environment.navigator = { mediaDevices: {} };

    const support = SpeechAssistant.checkSupport(environment);

    assert.equal(support.recognition, false);
    assert.equal(support.supported, false);
    assert.deepEqual(support.issues, ["recognition-unsupported"]);
    assert.match(support.message, /speech recognition is not supported/i);
});

test("checkSupport flags an insecure context even when recognition exists", () => {
    const environment = createEnvironment();
    environment.navigator = { mediaDevices: {} };
    environment.isSecureContext = false;

    const support = SpeechAssistant.checkSupport(environment);

    assert.equal(support.recognition, true);
    assert.equal(support.secureContext, false);
    assert.equal(support.supported, false);
    assert.deepEqual(support.issues, ["insecure-context"]);
    assert.match(support.message, /secure connection/i);
});

test("checkSupport flags missing synthesis and media devices", () => {
    const environment = createEnvironment();
    environment.speechSynthesis = undefined;

    const support = SpeechAssistant.checkSupport(environment);

    assert.equal(support.canSpeak, false);
    assert.equal(support.supported, false);
    assert.ok(support.issues.includes("synthesis-unsupported"));
    assert.ok(support.issues.includes("no-media-devices"));
});

test("start() refuses an insecure context with the insecure-context code", () => {
    const environment = createEnvironment();
    environment.isSecureContext = false;
    const assistant = new SpeechAssistant({ environment });
    const errors = [];
    assistant.on("error", ({ code }) => errors.push(code));

    assert.equal(assistant.start(), false);
    assert.deepEqual(errors, ["insecure-context"]);
    assert.equal(assistant.getState().conversationActive, false);
});

test("getSupport() reflects the same capability report", () => {
    const environment = createEnvironment();
    environment.navigator = { mediaDevices: {} };
    const assistant = new SpeechAssistant({ environment });

    const support = assistant.getSupport();

    assert.equal(support.supported, true);
    assert.deepEqual(support, SpeechAssistant.checkSupport(environment));
});

function jsonResponse(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null
        },
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("endpoint mode sends the transcript with a bearer token and speaks the reply", async () => {
    const environment = createEnvironment();
    environment.navigator = { mediaDevices: {} };
    const calls = [];
    environment.fetch = async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, { reply: "Twelve customers.", intent: "customers" });
    };

    const assistant = new SpeechAssistant({
        environment,
        endpoint: "/api/assistant",
        token: "tok-123",
        restartDelay: 10
    });
    const intents = [];
    assistant.on("intent", ({ intent }) => intents.push(intent));

    assistant.start();
    assistant.recognition.onresult({
        resultIndex: 0,
        results: [[{ transcript: "how many customers" }]]
    });
    await flush();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/assistant");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok-123");
    assert.deepEqual(JSON.parse(calls[0].init.body), { message: "how many customers" });
    assert.deepEqual(intents, ["customers"]);
    assert.equal(environment.speechSynthesis.utterances[0].text, "Twelve customers.");
});

test("endpoint mode reads a function token before every request", async () => {
    const environment = createEnvironment();
    const seen = [];
    environment.fetch = async (url, init) => {
        seen.push(init.headers.Authorization);
        return jsonResponse(200, { reply: "ok" });
    };

    let counter = 0;
    const assistant = new SpeechAssistant({
        environment,
        endpoint: "/api/assistant",
        token: () => "tok-" + (++counter)
    });

    assistant.sendText("first");
    await flush();
    assistant.sendText("second");
    await flush();

    assert.deepEqual(seen, ["Bearer tok-1", "Bearer tok-2"]);
});

test("a 401 from the endpoint ends the session and blocks further listening", async () => {
    const environment = createEnvironment();
    environment.fetch = async () => jsonResponse(401, { detail: "expired" });

    const assistant = new SpeechAssistant({ environment, endpoint: "/api/assistant" });
    const errors = [];
    assistant.on("error", ({ code }) => errors.push(code));

    assistant.start();
    assistant.recognition.onresult({ resultIndex: 0, results: [[{ transcript: "secret stuff" }]] });
    await flush();

    assert.deepEqual(errors, ["unauthorized"]);
    assert.equal(assistant.getState().conversationActive, false);
    assert.equal(assistant.getState().processing, false);
    assert.equal(environment.speechSynthesis.utterances.length, 0);
    assert.match(assistant.getState().status, /sign in again/i);
});

test("a 403 with a spoken explanation keeps the conversation alive", async () => {
    const environment = createEnvironment();
    environment.fetch = async () => jsonResponse(403, {
        reply: "You are not allowed to view payroll."
    });

    const assistant = new SpeechAssistant({
        environment,
        endpoint: "/api/assistant",
        restartDelay: 10
    });
    assistant.start();
    assistant.recognition.onresult({ resultIndex: 0, results: [[{ transcript: "show payroll" }]] });
    await flush();

    assert.equal(environment.speechSynthesis.utterances[0].text, "You are not allowed to view payroll.");
    assert.equal(assistant.getState().conversationActive, true);
    assert.equal(assistant.getState().processing, false);
});

test("interim results are emitted but never acted on", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({
        environment,
        onCommand: async () => "should not run"
    });
    const interim = [];
    const transcripts = [];
    assistant.on("interim", ({ text }) => interim.push(text));
    assistant.on("transcript", (event) => transcripts.push(event));

    assistant.start();
    const partial = [{ transcript: "show cust" }];
    partial.isFinal = false;
    assistant.recognition.onresult({ resultIndex: 0, results: [partial] });

    assert.deepEqual(interim, ["show cust"]);
    assert.deepEqual(transcripts, []);
    assert.equal(assistant.getState().processing, false);
});

test("sendText runs the same pipeline as speech", async () => {
    const environment = createEnvironment();
    const seen = [];
    const assistant = new SpeechAssistant({
        environment,
        onCommand: async ({ transcript }) => {
            seen.push(transcript);
            return "Got it.";
        }
    });

    assistant.sendText("  Show inventory  ");
    await flush();

    assert.deepEqual(seen, ["Show inventory"]);
    assert.equal(environment.speechSynthesis.utterances[0].text, "Got it.");
});

test("voice option picks a matching synthesis voice", () => {
    const environment = createEnvironment();
    environment.navigator = { mediaDevices: {} };
    environment.speechSynthesis.getVoices = () => [
        { name: "Other", voiceURI: "other" },
        { name: "Samantha", voiceURI: "samantha" }
    ];

    const assistant = new SpeechAssistant({ environment, voice: "Samantha" });
    assistant.speak("hello");

    assert.equal(assistant.currentSpeech.voice.name, "Samantha");
});

test("welcome() speaks the greeting and starts the conversation", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({ environment });

    assert.equal(assistant.welcome("Hello there"), true);
    assert.equal(assistant.getState().conversationActive, true);
    assert.equal(environment.speechSynthesis.utterances[0].text, "Hello there");

    environment.speechSynthesis.utterances[0].onend();
    environment.runTimers();
    assert.equal(assistant.recognition.startCount, 1);
});

test("welcome() falls back to listening when text-to-speech is unavailable", () => {
    const environment = createEnvironment();
    environment.speechSynthesis = undefined;

    const assistant = new SpeechAssistant({ environment });
    const errors = [];
    assistant.on("error", ({ code }) => errors.push(code));

    assert.equal(assistant.welcome("Hello there"), false);
    assert.deepEqual(errors, ["unsupported-synthesis"]);
    assert.equal(assistant.getState().listening, true);
    assert.equal(assistant.recognition.startCount, 1);
});

test("messages option overrides status lines but keeps the defaults", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({
        environment,
        messages: { listening: "Go ahead, I'm listening" }
    });
    const statuses = [];
    assistant.on("status", ({ message }) => statuses.push(message));

    assistant.start();

    assert.deepEqual(statuses, ["Go ahead, I'm listening"]);
    assert.equal(assistant.getOptions().messages.ready, "Ready");
    assert.equal(
        assistant.getOptions().messages.listening,
        "Go ahead, I'm listening"
    );
});

test("checkSupport accepts custom messages", () => {
    const environment = createEnvironment({ recognition: false });

    const support = SpeechAssistant.checkSupport(environment, {
        recognitionUnsupported: "Use Chrome for voice."
    });

    assert.equal(support.message, "Use Chrome for voice.");
});

test("welcome() uses the welcomeMessage option when called without an argument", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({
        environment,
        welcomeMessage: "Welcome to Acme."
    });

    assert.equal(assistant.welcome(), true);
    assert.equal(environment.speechSynthesis.utterances[0].text, "Welcome to Acme.");
});

test("configure() updates live options, merges messages, and validates input", () => {
    const environment = createEnvironment();
    const assistant = new SpeechAssistant({
        environment,
        messages: { ready: "Idle" }
    });

    assistant.configure({
        welcomeMessage: "Hi from Acme",
        lang: "en-GB",
        rate: 1.25,
        messages: { listening: "Speak" }
    });

    const options = assistant.getOptions();
    assert.equal(options.welcomeMessage, "Hi from Acme");
    assert.equal(options.lang, "en-GB");
    assert.equal(options.rate, 1.25);
    assert.equal(assistant.recognition.lang, "en-GB");
    assert.equal(options.messages.ready, "Idle");
    assert.equal(options.messages.listening, "Speak");

    assert.throws(
        () => assistant.configure({ rate: "fast" }),
        /rate, pitch and volume must be numbers/
    );
    assert.throws(
        () => assistant.configure({ welcomeMessage: "  " }),
        /welcomeMessage must be a non-empty string/
    );
});

test("onCommand may return { reply, intent } like the server", async () => {
    const environment = createEnvironment();
    const intents = [];
    const assistant = new SpeechAssistant({
        environment,
        onCommand: async () => ({ reply: "Bye!", intent: "goodbye" })
    });
    assistant.on("intent", ({ intent }) => intents.push(intent));

    assistant.sendText("goodbye");
    await flush();

    assert.deepEqual(intents, ["goodbye"]);
    assert.equal(environment.speechSynthesis.utterances[0].text, "Bye!");
});

test("DEFAULT_MESSAGES exposes the built-in status text for overrides", () => {
    assert.equal(SpeechAssistant.DEFAULT_MESSAGES.listening, "Listening... Speak now");
    assert.equal(typeof SpeechAssistant.DEFAULT_MESSAGES.sessionExpired, "string");
});
