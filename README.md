# NeuroGrip — Neural Hand Tracer

A browser-based real-time hand-tracking HUD. Uses [MediaPipe Hands](https://developers.google.com/mediapipe) for landmark detection and renders a glowing neon skeleton with comet-trail effects over your webcam feed, plus a live stats HUD (hands detected, FPS, gesture, speed).

## Project structure

```
neurogrip/
├── index.html   # markup + MediaPipe CDN script tags
├── style.css    # HUD / neon visual theme
├── script.js    # camera setup, landmark rendering, gesture + speed logic
└── README.md
```

## Running it

No build step or install required — it's plain HTML/CSS/JS.

1. Open `index.html` in a modern browser (Chrome, Edge, or Firefox recommended).
   - Easiest: double-click the file, or run a tiny local server if your browser blocks camera access on `file://`:
     ```bash
     cd neurogrip
     python3 -m http.server 8000
     # then visit http://localhost:8000
     ```
2. Click **Enable Camera** and grant permission.
3. Move your hand in front of the camera — the HUD updates live.

Everything runs client-side. Video never leaves your machine; MediaPipe's model files are fetched from its CDN the first time you load the page.

## How it works

- **Detection**: `Hands` (from `@mediapipe/hands`) returns 21 landmarks per detected hand, each frame, via `Camera` (from `@mediapipe/camera_utils`) driving the webcam feed.
- **Rendering**: `script.js` draws glowing lines between landmarks (color-coded per finger), plus a fading trail buffer per fingertip for the light-painting effect. The canvas isn't fully cleared each frame — instead a low-alpha rectangle is drawn on top, which is what produces the trailing motion blur.
- **Gesture classification**: heuristic, not a trained model. It compares each fingertip's distance from the wrist to that finger's knuckle-to-wrist distance to estimate curl, and checks thumb-to-index distance for a pinch. Classes: `Fist`, `Open Palm`, `Pinch`, `Point`, `Relaxed`.
- **Speed**: frame-to-frame wrist displacement (in normalized coordinates) divided by elapsed time, scaled and smoothed into a 0–100% meter.

## Customizing

- **Colors / theme** — edit the CSS custom properties at the top of `style.css` (`--cyan`, `--magenta`, etc.) and `FINGER_COLORS` in `script.js`.
- **Trail length** — `TRAIL_LEN` in `script.js`.
- **Number of hands** — `maxNumHands` in the `handsModel.setOptions(...)` call.
- **Gesture logic** — `classifyGesture()` in `script.js`; thresholds are simple ratios, easy to tune or extend with new gesture classes.

## Notes

- Requires camera permission; if it's blocked in an embedded/sandboxed preview, open the file directly in a full browser tab (or serve it locally as above).
- Gesture and speed detection are heuristic approximations for a demo, not a trained classifier — good starting point if you want to swap in something more robust later.
