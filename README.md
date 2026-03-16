# Bloom

Bloom is a separate Expo/React Native sibling app for the art app at `../old_art_app`.

Current scaffold:
- Imports the current JSON export format from the web app.
- Treats imported layers as a style pool and picks randomly per tap.
- Maps `Y` to scale-snapped pitch metadata and `X` to filter cutoff metadata.
- Maps press length to shape lifetime, note length, attack, release, and size.
- Applies JSON movement styles (`bounce`, `drift`, `orbit`, `still`) to spawned shapes.
- Supports direct two-finger pinch on a live shape to permanently stretch that spawned shape and update its sound descriptor.

Current limitation:
- The visual interaction layer is implemented.
- `BloomAudioEngine` is still a stub descriptor engine, not the final low-latency FM synth. That native audio spike is the next hard step.
- Blend-mode labels are preserved from the imported JSON, but full compositing fidelity still needs the planned Skia renderer pass.

## Run

```bash
cd /Users/regvardy/Documents/nodejs/gavXflx/Bloom
npm start
```

## Next build steps

1. Replace `BloomAudioEngine` with a real mobile FM engine.
2. Move rendering from `react-native-svg` to Skia for stronger blend-mode fidelity and better composition control.
3. Add file-share import and bundled preset browser.
4. Add adaptive voice limiting once real audio is wired up.
