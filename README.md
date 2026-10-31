# Speech Assistant

A dependency-free browser library for voice conversations. One script tag, one
constructor, and your server does the thinking.

```html
<script src="speech-assistant.js"></script>
<script>
    const assistant = new SpeechAssistant({ endpoint: "/api/assistant" });
    assistant.start();   // call from a click to request microphone access
</script>
```

Your API receives `POST { "message": "what the user said" }` and returns
`{ "reply": "what to say back" }`. The library handles the mic, the token, the
request, 401s, and speaking the reply.

## How it works

```
browser microphone
      |
      v
Web Speech API  ->  transcript  ->  POST { message }
                                        Authorization: Bearer <token>
                                        |
                                        v
                                   your server
                                        |
                                   { reply, intent? }
                                        |
                                        v
                              speechSynthesis  ->  speaker
                                        |
                                        v
                               listening resumes
```

The mic is paused while the request is in flight (status `Thinking...`), then
resumes automatically after the reply is spoken. No double-answers, no
self-listening.

## Options

| Option | Default | Description |
|---|---|---|
| `endpoint` | `null` | URL that receives `{ message }` and returns `{ reply }`. Omit to use the built-in demo commands |
| `token` | `null` | string, or a function returning a string/Promise, read before **every** request. Sent as `Authorization: Bearer <token>` |
| `onCommand` | `null` | Fully custom async handler. Overrides `endpoint` |
| `lang` | `"en-IN"` | BCP-47 language for recognition and speech |
| `continuous` | `false` | Keep recognition open; the library restarts it anyway |
| `interimResults` | `false` | Emit `interim` events while the user is still talking |
| `restartDelay` | `700` | ms to wait before listening again |
| `rate` / `pitch` / `volume` | `1` | Speech synthesis settings |
| `voice` | `null` | Voice name, `voiceURI`, or a `SpeechSynthesisVoice` object |
| `welcomeMessage` | `null` | Default text for `welcome()` when called without an argument |
| `messages` | see below | Object of status-line overrides, merged with the defaults |
| `credentials` | `"same-origin"` | Passed to `fetch`; use `"include"` cross-origin |
| `requestTimeout` | `15000` | ms before the request is aborted |
| `environment` | `globalThis` | Injection point for tests |

## Configuration

Every option can be changed after construction:

```js
assistant.configure({
    rate: 1.2,
    lang: "en-GB",
    welcomeMessage: "Welcome to Acme.",
    messages: { thinking: "Working on it..." }
});

assistant.getOptions();   // full, merged options
```

`messages` is merged, so each call only needs the lines you are changing. The
defaults are available as `SpeechAssistant.DEFAULT_MESSAGES`, and
`checkSupport()` accepts the same overrides so its explanation matches your UI:

```js
const support = SpeechAssistant.checkSupport(window, {
    recognitionUnsupported: "Please use Chrome for voice."
});
```

| Message key | Used when |
|---|---|
| `ready`, `readyToChat` | idle / ready to start |
| `listening`, `listeningAgain` | listening for speech |
| `thinking` | request in flight |
| `speaking` | reply is being spoken |
| `conversationEnded` | `stop()` finishes |
| `sessionExpired`, `signInRequired` | 401 / no token |
| `microphoneDenied`, `noSpeech`, `networkError`, `recognitionError` | mic problems |
| `recognitionUnsupported`, `synthesisUnsupported`, `insecureContext`, `noMediaDevices`, `supported` | capability report |
| `requestFailed`, `apology` | server or handler failed |
| `startToEnableSpeech` | browser blocked autoplay, needs a click |
| `startRecognitionFailed`, `synthesisFailed` | API threw (suffix is appended) |

## Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `boolean` | Begin a conversation. Call from a user gesture |
| `stop()` | – | End the conversation, cancel speech, abort any request |
| `welcome(text?)` | `boolean` | Start the conversation by speaking first; falls back to listening if TTS is unavailable |
| `configure(patch)` | object | Change any option at runtime; merges `messages` |
| `getOptions()` | object | Current options, including the full `messages` map |
| `speak(text)` | `boolean` | Speak without listening |
| `sendText(text)` | `true` | Feed text in as if it was spoken (text fallback, tests) |
| `handleCommand(text)` | – | Run the built-in keyword routes |
| `getState()` | object | `{ conversationActive, listening, speaking, processing, status }` |
| `getSupport()` | object | Same report as `SpeechAssistant.checkSupport()` |
| `getVoices()` | array | Available synthesis voices |
| `on(event, fn)` | function | Subscribe; the return value unsubscribes |
| `destroy()` | – | Stop and remove all listeners |
| `SpeechAssistant.checkSupport(env?, messages?)` | object | Static pre-flight check, see below |
| `SpeechAssistant.DEFAULT_MESSAGES` | object | Built-in status text, for building your own overrides |

## Events

```js
const off = assistant.on("transcript", ({ transcript }) => {
    console.log("User said:", transcript);
});
```

| Event | Payload |
|---|---|
| `status` | `{ message }` — human-readable state for your UI |
| `transcript` | `{ command, transcript }` — final user speech (`transcript` keeps casing) |
| `interim` | `{ text }` — partial speech, only with `interimResults: true` |
| `response` | `{ message }` — the reply about to be spoken |
| `intent` | `{ intent, pageName?, command, transcript? }` — from built-in routes or your server's `intent` field |
| `speechend` | `{ message, completed }` |
| `state` | `{ conversationActive, listening, speaking, processing, status }` |
| `error` | `{ error, code }` |

Error codes: `unsupported-recognition`, `insecure-context`, `unauthorized`,
`command-handler`, `recognition-start`, `recognition-stop`, `recognition-error`,
`not-allowed`, `no-speech`, `network`, `synthesis-error`, `synthesis-failed`,
`synthesis-cancel`.

## Your API contract

```
POST /api/assistant
Content-Type: application/json
Authorization: Bearer <token>          (when a token is configured)

{ "message": "how many customers signed up today" }
```

Any of these responses work:

```json
{ "reply": "Twelve customers signed up today." }
{ "reply": "Goodbye! Have a great day.", "intent": "goodbye" }
"A plain string reply"
```

Status handling:

| Status | Library behavior |
|---|---|
| `200` | Speaks `reply` |
| `401` | Ends the conversation, emits `error { code: "unauthorized" }` |
| `403` | Speaks `reply` if present, keeps the session alive |
| other | Speaks a short apology, keeps listening |

Use `401` only for a missing or expired session. Return **200 with a spoken
refusal** for "you're signed in but not allowed to do that" — the assistant can
then explain the denial and keep listening instead of logging the user out.

## Auth flow

The library never logs anyone in. Your app owns login; the library attaches the
token and reacts to expiry.

```js
let token = null;

const assistant = new SpeechAssistant({
    endpoint: "/api/assistant",
    token: () => token           // re-read before every request
});

// On page load: ask your server, not the library.
const res = await fetch("/api/session", { credentials: "same-origin" });
if (res.ok) {
    token = (await res.json()).token;     // already signed in
} else {
    showLogin();                          // your UI
}

// On successful login: the server decides, the library just stores it.
async function login(username, password) {
    const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });
    if (!res.ok) return showError("Invalid credentials");
    token = (await res.json()).token;
    assistant.start();
}

assistant.on("error", ({ code }) => {
    if (code === "unauthorized") {
        token = null;
        showLogin();                      // redirect to login
    }
});
```

"Already logged in" is a response from *your* server (`/api/session` or
`/api/login`). The library has no opinion about it.

A token in the page is readable by the user. Use it for identification and
quotas; authorize every action server-side. If you can, prefer an HttpOnly
session cookie and skip the token entirely — the request already sends
credentials.

## Checking browser support

Run this before enabling the mic:

```js
const support = SpeechAssistant.checkSupport();

if (!support.supported) {
    status.textContent = support.message;
    micButton.disabled = true;
}
```

| Field | Meaning |
|---|---|
| `recognition` | speech recognition API exists |
| `synthesis` | speech synthesis API exists |
| `secureContext` | HTTPS or localhost |
| `microphone` | `navigator.mediaDevices` exists (advisory) |
| `canListen` | `recognition && secureContext` |
| `canSpeak` | `synthesis` |
| `supported` | `canListen && canSpeak` |
| `issues` | e.g. `recognition-unsupported`, `insecure-context` |
| `message` | plain-English reason and fix |

`start()` also refuses early, without touching the mic, on
`unsupported-recognition` and `insecure-context`.

## Text fallback

Recognition is not available everywhere. The same pipeline accepts typed input:

```js
const support = SpeechAssistant.checkSupport();

if (support.canListen) {
    assistant.start();
} else {
    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !input.value.trim()) return;
        assistant.sendText(input.value);
        input.value = "";
    });
}
```

`sendText()` fires the same `transcript` event, sends the same request, and
speaks the same reply.

## Hosting on another server

The file is self-contained: no imports, no build step. Copy it to any static
host and load it by URL. Cross-origin script tags do not need CORS.

```html
<script src="https://assets.example.com/v1/speech-assistant.js"></script>
```

Requirements:

- **HTTPS.** An HTTPS page cannot load an `http://` script, and the mic needs a
  secure origin.
- **`Content-Type: application/javascript`.** A wrong MIME type plus
  `X-Content-Type-Options: nosniff` blocks the script.
- **Versioned path + long cache.** `/v1/speech-assistant.js` with
  `Cache-Control: public, max-age=31536000, immutable`. An unversioned file
  changes under every embedding site at once.
- **CSP.** Allow the host: `script-src 'self' https://assets.example.com`.
- **`Cross-Origin-Resource-Policy: cross-origin`** if embedding pages send
  `COEP: require-corp`.

### SRI (optional)

```bash
openssl dgst -sha384 -binary speech-assistant.js | openssl base64 -A
```

```html
<script src="https://assets.example.com/v1/speech-assistant.js"
        integrity="sha384-..."
        crossorigin="anonymous"></script>
```

Adding `integrity` makes the request CORS-enabled, so the host must send
`Access-Control-Allow-Origin: *` or the browser blocks the script.

## Browser support

| Browser | Recognition | Synthesis |
|---|---|---|
| Chrome / Edge (desktop, Android) | Yes | Yes |
| Safari (macOS, iOS) | Yes | Yes |
| Firefox | No | Yes |

Firefox has no speech recognition, so `getSupport().recognition` is `false` and
`start()` emits `unsupported-recognition` — use the text fallback above. Chrome
sends recognition audio to Google; there is no way to keep it local with the Web
Speech API. For sensitive audio, record with `MediaRecorder` and transcribe on
your server.

## Security notes

- Everything here runs on the user's machine. `transcript` is untrusted input; a
  user can edit it in DevTools or call your endpoint directly.
- HTTPS protects the request in transit. It does not prove the words were spoken.
- Authorize every action server-side using the session, never anything the client
  sends.
- The library never uses `innerHTML`; render `transcript`/`response` with
  `textContent`.
- Anyone within earshot can issue commands. Add a confirmation step for
  destructive actions.

## Demo page

`index.html` is markup only — no inline styles or scripts. Three files drive it:

| File | Purpose |
|---|---|
| `config.js` | everything a company changes: branding, welcome text, labels, suggestions, demo replies, theme, messages, endpoint |
| `app.js` | reads the config, applies it to the page, wires the controls |
| `styles.css` | layout and theme, driven by CSS variables |

```html
<link rel="stylesheet" href="styles.css">
...
<script src="config.js"></script>
<script src="speech-assistant.js"></script>
<script src="app.js"></script>
```

Re-branding is a config edit — no changes to `app.js` or the library:

```js
// config.js
window.VOICE_ASSISTANT_CONFIG = {
    title: "Acme Voice Help",
    description: "Ask about orders, billing or support.",
    welcomeMessage: "Welcome to Acme. How can I help?",
    endpoint: "/api/assistant",
    texts: { youSaid: "You asked", assistant: "Acme", send: "Ask" },
    suggestions: ["Check my order", "Talk to support"],
    theme: { accent: "#f59e0b", primary: "#0ea5e9" }
};
```

Everything stays adjustable at runtime too:

```js
window.voiceAssistant.configure({
    title: "Acme Billing",
    welcomeMessage: "Welcome to Acme billing.",
    theme: { accent: "#f59e0b" }
});

window.voiceAssistant.setAuthToken(token);   // after login
window.voiceAssistant.getConfig();           // current page config
window.voiceAssistant.assistant;             // full library API
```

The page includes a text box wired to `sendText()`, so it stays usable when
recognition is unavailable. The first mic click plays `welcomeMessage`, then
starts listening; later clicks just resume. With `endpoint: null` the
`demoCommands` in `config.js` answer locally, so the page runs with no backend.
Auth is required automatically whenever `endpoint` is set; `requiresAuth` can
override that. On `unauthorized` the page blocks input until a fresh token is
set.

## Built-in commands

`handleCommand()` is used only when both `endpoint` and `onCommand` are absent:
dashboard, customers, inventory, sales report, help, hello, thanks, goodbye.
They emit `intent` events that you can wire to navigation.

The demo page does not rely on those hardcoded routes. Its keyword replies live
in `config.js` under `demoCommands`, are returned through `onCommand` as
`{ reply, intent }`, and can be changed or translated per company.
# speech-recognition
