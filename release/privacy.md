# Privacy Policy for 微信悦读 (WeRead Enhancer)

**Last updated: 2026-10-11**

## Data Collection

This extension does **not collect, store, or transmit any personal data or browsing information to its author or any third party** — with a single, narrowly-scoped exception: an **anonymous usage counter** that is **on by default and can be turned off** (see "Anonymous Usage Statistics" below).

- No analytics, tracking, or advertising SDKs are included. The anonymous usage counter is **self-built** (our own function + database) and carries **no third-party code**.
- No data is sent to any server other than the domains described below (WeRead's own gateway, our own anonymous-counter endpoint, and — only if you opt in to the optional AI enhancement — the API of the domestic AI model you choose).
- The extension also makes a single, anonymous GET request to its companion website (`reader.chesterlee.cn`) to check whether a newer version is available. This request carries no user data or identifiers, is cached locally for 24 hours, and is silently ignored on failure.
- No cookies are created or read beyond what the extension needs to function.

## Reading Notes / Highlights

The "Notes" feature reads your own highlights, thoughts and annotations for the current book directly from WeRead's official same-origin endpoints (`weread.qq.com`), using your existing login session in that tab. This is the same origin you are already browsing:

- Requests go **only to `weread.qq.com`** — never to any third-party or external server.
- Retrieved notes are kept **in memory only** (a short-lived cache) and are **never persisted or uploaded**.
- If the endpoints are unavailable, the extension falls back to reading the highlights already rendered on the page.

## Official Data (Reading Activity Report) — optional, opt-in

The "Official Data" feature is **off by default** and requires you to paste **your own** WeRead API Key (a `wrk-` token that you create in the WeRead App on the "WeRead Skill" page).

- The Key is stored **only locally** in `chrome.storage.local` on your own device. It is never sent to the extension's author or any third party (unless you explicitly enable the optional **Plugin Account Sync** described below).
- When you open the report, the extension sends the Key and your request **only to WeRead's official gateway `i.weread.qq.com`** (via the extension's background service worker) — the same official service the WeRead App skill uses. No other server is contacted.
- The report is **generated locally in your browser**; the resulting report is not uploaded anywhere. Exporting simply saves a file to your own computer.
- You can remove the Key at any time from the "🔑 API Key" menu entry (it is then deleted from local storage together with the report cache).
- Security note: the Key grants read access to your own WeRead data. Treat it like a password — do not share it or commit it to any repository.

## AI Enhancement (Domestic LLM) — optional, opt-in

The "Official Data" report can optionally upgrade its "Executive Summary" and persona wording with AI-generated text. This is **off by default** and requires you to paste **your own** API Key from a **domestic (China-based) AI provider**. Built-in presets are DeepSeek, Qwen (Aliyun Bailian), Kimi (Moonshot), Zhipu GLM, Doubao (Volcano Ark) and SiliconFlow; you may also add a custom OpenAI-compatible endpoint. **No foreign model (OpenAI / Claude / Gemini / OpenRouter, etc.) is offered.**

- The Key is stored **only locally** in `chrome.storage.local` (each provider's Key is kept separately) and is never sent to the extension's author or any third party (unless you explicitly enable the optional **Plugin Account Sync** described below).
- All report numbers are still computed **locally by fixed rules**; the AI model only turns those already-computed facts (plus a small sample of your own highlights/thoughts) into natural-language wording. It never computes the statistics itself.
- When enabled, the extension sends **only** the following to the base URL of the provider you selected: a summary of your shelf/cumulative reading/notes/finish-rate/category preferences, annual trend, and a bounded sample of highlight/thought text from the top few most-annotated books (at most 6 samples per book). Your WeRead `wrk-` Key is **never** sent to the AI provider.
- If you do not configure an AI Key, **no request is ever made** to any AI provider, and the report falls back to the rule-based summary.
- You can remove any provider's Key at any time from the "🔑 API Key" menu entry.

## Plugin Account Sync — optional, off by default

The extension's "🔑 API Key" panel also offers an **optional** "账户与多端同步" (account & cross-device sync) section.

- It is **off by default**. When off, the extension behaves exactly as before: your Keys are stored **only locally** in `chrome.storage.local` and never uploaded.
- Only if you **explicitly enable it** (or log in on this device with your account code / a 6-digit login code) will your already-configured WeRead Key and the AI Key of your **currently selected provider** be **encrypted (AES-256-GCM) and hosted** on our self-built cloud function, under the **same account code** shared with the website and web app — so you configure a Key once and it is available on every device.
- Once enabled, the extension **pulls the hosted Keys back to your device** to call the WeRead official gateway / AI provider directly (the same request path as when sync is off — requests still do not pass through the author's server). This also means **anyone holding your account code can retrieve the Key plaintext**, so keep your account code as safe as a password.
- You can at any time "关闭同步" (turn off sync — local Keys kept, no further syncing), "清除云端 Key" (delete the hosted Keys — local Keys unaffected), or "退出账户" (log out) from the panel. After the hosted Keys are deleted, other devices can no longer sync them.

## Reading Persona & Share Image — local only

The "Official Data" report includes a "Reading Persona" card (a 4-letter type derived from your own reading behaviour) and a word-frequency analysis, plus an optional vertical "share image" (PNG) you can download or copy.

- The four-dimension judgement, word frequencies, emotion ratios, catchphrases and themes are **computed entirely on your device by fixed rules** — no external library, no random values, and no AI is required. Any AI wording is optional and follows the "AI Enhancement" section above (same bounded input, same opt-in).
- The share image is **drawn locally with the browser's Canvas 2D API** and saved/copied directly on your machine. It is **never uploaded**.
- The share image contains **only aggregated statistics you choose to display and the type name** — it embeds **no nickname, no avatar and no account identifier (uid)**. It contains no QR code.
- This feature adds **no new permissions**; it only reuses the same WeRead official gateway for reading your own notes.

## Anonymous Usage Statistics — default on, one-click off

To understand whether the extension is being used at all, the extension sends **at most one** anonymous "active" event per day to our own self-built endpoint (a WeRead-Enhancer cloud function). It is **enabled by default** and announced on first run; you can **turn it off at any time** in the extension's "阅读设置" (Reading Settings) panel — once off, no further reports are sent.

- The payload contains **only**: ① a **random, locally-generated anonymous identifier** (a pure random UUID, created once on your device, containing no personal information); ② the extension **version number**; and ③ the **event name** (`active`). The date is recorded server-side; nothing else is sent.
- **Strictly never sent**: reading data or statistics, your `wrk-` key, your AI Key, your book list, any highlight/thought text, your IP address, browser fingerprints, or your WeRead account.
- The server stores **only per-day aggregate counts plus the random anonymous identifier**, in a dedicated collection, with a **90-day retention** (expired entries are purged; only aggregate counts remain).
- No third-party analytics or advertising SDK is involved.
- Turning it off: open the extension menu → "阅读设置" → "📊 匿名使用统计" → toggle to off.

## Local Storage

The extension uses `chrome.storage.local` solely for saving user preferences (such as screen ratio, auto-read speed, do-not-disturb, and full-screen settings) and, if you opt in, your own WeRead API Key, your own AI provider Key(s), and a short-lived report cache. It also stores the 24-hour cached result of the version check described above, and — for the anonymous usage counter — a locally-generated random anonymous identifier and the date of the last report. All data is stored locally in your browser and is only accessible to you. This data is never transmitted anywhere except the WeRead official gateway, our anonymous-counter endpoint, and (only if you opt in to the AI enhancement) the API of the AI provider you selected, as described above.

## Permissions

The extension requests the following permissions:

- **storage**: Required to save your reading preferences (and, optionally, your own API Keys) so they persist across page refreshes and browser restarts.
- **host permission for `https://i.weread.qq.com/*`**: Required only to send your own request to WeRead's official data gateway when you use the optional "Official Data" feature. No other host is accessed.
- **host permissions for the built-in AI providers** (`https://api.deepseek.com/*`, `https://dashscope.aliyuncs.com/*`, `https://api.moonshot.cn/*`, `https://open.bigmodel.cn/*`, `https://ark.cn-beijing.volces.com/*`, `https://api.siliconflow.cn/*`): Required only to send the bounded summary/sample described above to the AI provider you selected when you opt in to the optional AI enhancement. No request is made to any of these hosts unless you have configured that provider's Key.
- **optional host permission (`https://*/*`)**: Used only for a **custom OpenAI-compatible endpoint** you enter yourself. The permission for that specific domain is requested **at runtime** and only when you save/test the custom endpoint; it is never granted automatically and no other host is accessed.
- **host permission for `https://reader.chesterlee.cn/*`**: Required only to read the public version file (`/api/latest.json`) for the version-update hint. No user data is sent to this host.
- **host permission for `https://*.tcloudbase.com/*`**: Required only to send the anonymous "active" event described above to our self-built counter endpoint (a WeRead-Enhancer cloud function). If you turn the anonymous usage counter off, no request is ever made to this host.

## Scope

This extension only runs on `weread.qq.com` and does not interact with any other websites. The only external domains it can contact are `i.weread.qq.com` (WeRead's own official gateway, for the optional "Official Data" feature), the domestic AI provider(s) you select (for the optional AI enhancement — built-in: `api.deepseek.com`, `dashscope.aliyuncs.com`, `api.moonshot.cn`, `open.bigmodel.cn`, `ark.cn-beijing.volces.com`, `api.siliconflow.cn`; or a custom endpoint you authorize at runtime), `reader.chesterlee.cn` (the companion website, for the anonymous version check), and `*.tcloudbase.com` (our own anonymous-usage-counter endpoint; no request is made if you turn the counter off).

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/chengzilala/weread-enhancer/issues
