# Privacy Policy for 微信悦读 (WeRead Enhancer)

**Last updated: 2026-10-01**

## Data Collection

This extension **does not collect, store, or transmit any personal data or browsing information to its author or any third party**.

- No analytics, tracking, or advertising code is included.
- No data is sent to any server other than the domains described below (WeRead's own gateway, and — only if you opt in to the optional AI enhancement — DeepSeek's API).
- No cookies are created or read beyond what the extension needs to function.

## Reading Notes / Highlights

The "Notes" feature reads your own highlights, thoughts and annotations for the current book directly from WeRead's official same-origin endpoints (`weread.qq.com`), using your existing login session in that tab. This is the same origin you are already browsing:

- Requests go **only to `weread.qq.com`** — never to any third-party or external server.
- Retrieved notes are kept **in memory only** (a short-lived cache) and are **never persisted or uploaded**.
- If the endpoints are unavailable, the extension falls back to reading the highlights already rendered on the page.

## Official Data (Reading Activity Report) — optional, opt-in

The "Official Data" feature is **off by default** and requires you to paste **your own** WeRead API Key (a `wrk-` token that you create in the WeRead App on the "WeRead Skill" page).

- The Key is stored **only locally** in `chrome.storage.local` on your own device. It is never sent to the extension's author or any third party.
- When you open the report, the extension sends the Key and your request **only to WeRead's official gateway `i.weread.qq.com`** (via the extension's background service worker) — the same official service the WeRead App skill uses. No other server is contacted.
- The report is **generated locally in your browser**; the resulting report is not uploaded anywhere. Exporting simply saves a file to your own computer.
- You can remove the Key at any time from the "⚙️ 设置" tab (it is then deleted from local storage together with the report cache).
- Security note: the Key grants read access to your own WeRead data. Treat it like a password — do not share it or commit it to any repository.

## AI Enhancement (DeepSeek) — optional, opt-in

The "Official Data" report can optionally upgrade its "Executive Summary" with AI-generated wording. This is **off by default** and requires you to paste **your own** DeepSeek API Key (a `sk-` token).

- The Key is stored **only locally** in `chrome.storage.local` and is never sent to the extension's author or any third party.
- All report numbers are still computed **locally by fixed rules**; DeepSeek only turns those already-computed facts (plus a small sample of your own highlights/thoughts) into natural-language wording. It never computes the statistics itself.
- When enabled, the extension sends **only** the following to `api.deepseek.com`: a summary of your shelf/cumulative reading/notes/finish-rate/category preferences, annual trend, and a bounded sample of highlight/thought text from the top few most-annotated books (at most 6 samples per book). Your WeRead `wrk-` Key is **never** sent to DeepSeek.
- If you do not configure a DeepSeek Key, **no request is ever made to `api.deepseek.com`**, and the report falls back to the rule-based summary.
- You can remove the DeepSeek Key at any time from the "⚙️ 设置" tab.

## Local Storage

The extension uses `chrome.storage.local` solely for saving user preferences (such as screen ratio, theme, auto-read speed, do-not-disturb, and full-screen settings) and, if you opt in, your own WeRead API Key, your own DeepSeek API Key, and a short-lived report cache. All data is stored locally in your browser and is only accessible to you. This data is never transmitted anywhere except the WeRead official gateway and (only if you opt in to the AI enhancement) DeepSeek's API as described above.

## Permissions

The extension requests the following permissions:

- **storage**: Required to save your reading preferences (and, optionally, your own API Keys) so they persist across page refreshes and browser restarts.
- **host permission for `https://i.weread.qq.com/*`**: Required only to send your own request to WeRead's official data gateway when you use the optional "Official Data" feature. No other host is accessed.
- **host permission for `https://api.deepseek.com/*`**: Required only to send the bounded summary/sample described above to DeepSeek when you opt in to the optional AI enhancement. No request is made to this host unless you have configured a DeepSeek Key.

## Scope

This extension only runs on `weread.qq.com` and does not interact with any other websites. The only external domains it can contact are `i.weread.qq.com` (WeRead's own official gateway, for the optional "Official Data" feature) and `api.deepseek.com` (DeepSeek's API, for the optional AI enhancement).

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/chengzilala/weread-enhancer/issues
