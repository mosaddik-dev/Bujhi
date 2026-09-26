ঠিক আছে—Voice অংশটা আরও granular করা দরকার, যাতে **English ও Bangla আলাদাভাবে on/off এবং আলাদা voice নির্বাচন** করা যায়। পুরো revised prompt:

Build a production-ready Chrome extension called **Bujhi**.

### Core idea

Bujhi is a minimalist translation assistant for any website, including WhatsApp Web, Facebook, Gmail, etc.

Users can select text and click the Bujhi extension icon to translate it naturally.

### Translation

* English → simple, natural, human-readable Bangla.
* Bangla → natural, human-readable English.
* Never translate word-for-word when that sounds unnatural.
* Preserve the original meaning, tone, and context.
* The output should sound like something a real person would naturally say.
* Keep translations concise unless the original text is long.

### UX

* Selecting text and clicking the extension should be extremely fast.
* Show a small, clean floating result UI near the selected text.
* Allow Copy, Retry, and Close.
* When the user is typing a Bangla response, provide an easy way to convert it into natural English before sending.
* Do not interfere with normal website behavior.
* The UI must be minimal, polished, responsive, and unobtrusive.

### Voice

Voice is optional and controlled independently for each language.

**English voice settings:**

* English voice: ON/OFF
* Separate English voice selection dropdown

**Bangla voice settings:**

* Bangla voice: ON/OFF
* Separate Bangla voice selection dropdown

The user can independently enable or disable voice for either language.

For example:

* English → Bangla translation: Bangla voice ON
* Bangla → English translation: English voice OFF

The selected voice should automatically be used for that language.

Also provide a way to change the voice at any time from Settings.

Use **Cartesia TTS** and allow the user to configure their Cartesia API key in Settings.

### AI Providers

Create a provider abstraction so providers can easily be added or replaced.

Support:

* Google Gemini
* OpenRouter
* Groq
* Custom OpenAI-compatible API

Settings must allow users to enter:

* API key
* Custom API endpoint
* Model name

For OpenAI-compatible APIs, the user should be able to provide their own endpoint, API key, and model.

Use the best currently available suitable model from each provider for high-quality, fast translation. Keep provider/model configuration centralized so it can be updated easily.

### Fallback

Implement automatic fallback:

Primary provider
→ failure / timeout / rate-limit
→ next configured provider
→ next provider

Never expose API keys in page content or logs.

### Engineering requirements

* Production-ready Chrome Extension architecture.
* Manifest V3.
* Clean separation between content scripts, background/service worker, popup, settings, translation provider layer, and TTS layer.
* Secure API-key storage using Chrome extension storage APIs.
* Never hardcode API keys.
* Handle timeouts, rate limits, malformed responses, unavailable models, network failures, and empty selections gracefully.
* Avoid unnecessary API calls.
* Keep latency as low as reasonably possible.
* Do not break WhatsApp, Facebook, or other websites.
* Use modern JavaScript/TypeScript and clean, maintainable code.
* Keep dependencies minimal.
* Make the extension easy to build, test, and publish.

### Translation prompt

Use a small system prompt optimized for fast, natural translation:

"You are a natural English-Bangla translator. Translate meaning, not words. Use simple everyday language that a real person would naturally say. Preserve tone and context. Do not explain or add anything. Return only the translation."

For Bangla → English, reverse the direction while keeping the same principles.

### Important

Do not over-engineer the MVP.

Build the complete working extension with the cleanest architecture possible, then clearly explain:

1. Project structure
2. How translation providers work
3. How fallback works
4. How API keys are stored
5. How Cartesia TTS works
6. How English and Bangla voice settings work independently
7. How to configure providers and voices
8. How to build and load the extension in Chrome
9. Any production/security considerations

The final result should feel like a polished, fast, minimalist product—not a demo.
