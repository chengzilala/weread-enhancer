# Privacy Policy for 微信悦读 (WeRead Enhancer)

**Last updated: 2026-09-29**

## Data Collection

This extension **does not collect, store, or transmit any personal data or browsing information to its author or any third party**.

- No analytics, tracking, or advertising code is included.
- No data is sent to any server other than the two WeRead-owned domains described below.
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

## Local Storage

The extension uses `chrome.storage.local` solely for saving user preferences (such as screen ratio, theme, auto-read speed, do-not-disturb, and full-screen settings) and, if you opt in, your own WeRead API Key and a short-lived report cache. All data is stored locally in your browser and is only accessible to you. This data is never transmitted anywhere except the WeRead official gateway as described above.

## Permissions

The extension requests the following permissions:

- **storage**: Required to save your reading preferences (and, optionally, your own API Key) so they persist across page refreshes and browser restarts.
- **host permission for `https://i.weread.qq.com/*`**: Required only to send your own request to WeRead's official data gateway when you use the optional "Official Data" feature. No other host is accessed.

## Scope

This extension only runs on `weread.qq.com` and does not interact with any other websites. The only external domain it can contact is `i.weread.qq.com` (WeRead's own official gateway), and only for the optional "Official Data" feature.

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/chengzilala/weread-enhancer/issues
