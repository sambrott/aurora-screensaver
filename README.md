# Aurora screensaver

WebGL2 “liquid glass / aurora” animation built with **React**, **TypeScript**, and **Vite**. The animation runs in the browser and is meant to loop for ambient full-screen or screensaver use.

## Quick start (development)

```bash
git clone https://github.com/sambrott/aurora-screensaver.git
cd aurora-screensaver
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Build the production app

```bash
npm run build
```

Output is in `dist/`. You can confirm it locally with:

```bash
npm run preview
```

By default the preview server runs at `http://localhost:4173` (Vite will show the exact address).

## Downloading the project

- **With Git:** `git clone https://github.com/sambrott/aurora-screensaver.git`
- **Without Git:** on the GitHub repository page, use **Code → Download ZIP**, then unzip and use Terminal in the project folder for the commands above.

There is no separate “animation file” to download: the effect is real-time **WebGL2** in a web page. To use it as a macOS **Screen Saver**, you either point a web-based screensaver at a **local URL** (see below) or **capture a video** loop and use a **video** screensaver (also below).

---

## Use it as a Screen Saver on macOS

macOS does not ship a “drop in a URL” saver by default; this repo ships a native **WKWebView** screensaver bundle that loads the production build locally (no server).

### Option A (recommended): Embedded web + native `.saver` bundle

1. **Build:** from the repo root — `pnpm run build:screensaver` or `npm run build:screensaver`.
2. **Download / share:** **`artifacts/AuroraScreenSaver-mac.zip`** and **`artifacts/AuroraScreenSaver-mac-v0.4.0.zip`**, plus **`artifacts/AuroraScreenSaver.saver`**. Assets are served via **`aurora-local://`** (Swift `WKURLSchemeHandler`). WKWebKit in a ScreenSaver **`WKWebView` often never executes `<script type="module">`**, even when the loader works, so **`vite.screensaver.config.ts`** builds a single **classic IIFE** bundle and strips **`type="module"`**.
3. **Install:** double‑click **`AuroraScreenSaver.saver`** to install for your account, **or** extract the zip into **`~/Library/Screen Savers/`**.
4. **Enable:** **System Settings → Screen Saver** (or Desktop & Screen Saver on older macOS) → pick **Aurora**.

Requires **macOS 14+** and **Xcode Command Line Tools** (for `swiftc` / signing) only when building. The ZIP is **ad‑hoc signed** (fine on the machine that built it); redistribution to strangers needs **Apple Developer ID + notarization**.

See **`mac-screensaver/build-screensaver.sh`** if you adjust the Swift wrapper.

### Option B: WebView Screen Saver + local server

This keeps the real WebGL animation (sharpest, true loop, no re-encoding).

1. **Build and serve the static site** from a fixed port so the URL does not change:
   - In the project folder: `npm run build`
   - Serve `dist/`, for example:  
     `npx --yes serve dist -l 4173`  
     Leave this process running, or set up a small launch agent later if you want it to start at login.
2. You should be able to open `http://127.0.0.1:4173` in Safari or Chrome and see the app.
3. Install a **WebView**-based screen saver that can load a URL, for example **[WebViewScreenSaver](https://github.com/liquidx/webviewscreensaver)** (download the latest `.saver` from the project’s releases; open the file to install into System Settings).
4. On your Mac, open **System Settings → Screen Saver** (or **Desktop & Screen Saver** on older macOS), choose **WebViewScreenSaver** (or the one you installed), and set the URL to:  
   **`http://127.0.0.1:4173`**
5. For the screen saver to work, the static server from step 1 must be running whenever the screen locks. If it is not, you will get a blank or error page for that screen saver.

**Note:** Third-party URL-based WebView savers are unreliable with raw `file://` URLs—use **`http://127.0.0.1`** as above after `pnpm run build` / `npm run build` plus a static server. The Aurora **native** `.saver` (Option A) uses `WKWebView` with `loadFileURL` and bundles the assets.

### Option C: Record a video loop, use a video screen saver

If you prefer not to run a local server:

1. Run the app (`npm run dev` or `npm run preview`), put the window **full screen**, and use **QuickTime Player → File → New Screen Recording** (or another capture tool) to record **10–30+ seconds** of the animation. Trim so the end matches the start for a **seamless** loop, then export an **.mp4** (e.g. with QuickTime, iMovie, or HandBrake) and place it in a folder such as `~/Movies/Aurora/`.
2. Install a **video** screen saver that plays files from a folder. Third-party options change over time; search the Mac App Store for **“video screen saver”** or use a well-maintained open-source one if you trust the source. Point it at your exported `.mp4`.
3. This path is more portable but **re-encodes** the look and may not loop as cleanly as the live WebGL version.

### Option D: Full-screen in the browser (no system screen saver)

For desk-side “always on” use without a screen saver:

- `npm run preview` → open the URL → enter **full screen** in the browser (e.g. Chrome/Safari). Combine with **Energy Saver** if you need the display to stay on. This is not a lock-screen screen saver, but it is the simplest way to run the full-quality loop.

---

## Tech stack

- Vite, React, TypeScript, Tailwind, WebGL2 (fragment shader + refraction-style bubbles in `src`).
