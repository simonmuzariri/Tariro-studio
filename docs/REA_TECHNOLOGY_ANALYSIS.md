# REA Technology Analysis — PictoBlox 9.0.0

| Layer | Technology | Status | Evidence |
|---|---|---|---|
| Shell | Electron (ELF x86-64, 146 MB), Node 16.5.0 in main | V | `ev_33815109`, `ev_88377acb` |
| Packaging | electron-builder `.deb`, `app.asar` 70 MB (6,420 files) + `app.asar.unpacked/build` | V | asar inventory |
| Updater | electron-updater 4.x + custom Linux module, GitHub provider metadata | V | `app-update.yml`, log |
| UI framework | React 16 (peerDependency), Redux (INFERRED, scratch-gui lineage) | V/I | package.json |
| GUI base | Fork of `LLK/scratch-gui` (repository field, chunk names) | V | package.json, script URLs |
| Block engine | `scratch-blocks` fork (Blockly-derived; classes `blocklyFlyout`, `scratchCategoryMenuItem`) | V | DOM |
| VM | `scratch-vm` fork (89 MB chunk incl. extensions) | V (presence) | script list |
| Code editor | Ace (`.ace_editor`) | V | DOM probe |
| Local server | Express on :21679, socket server on :21677 | V | target URL, log |
| Serial | `serialport` 10.4.0 (native addon) | I | package metadata |
| BLE | noble (`NOBLE_BLUETOOTH_UNAVAILABLE` channel) | I | IPC names |
| Arduino toolchain | Arduino 1.8.5 `arduino-builder`, avr-gcc, avrdude; ESP32 core + esptool | V (files) / I (usage) | resources/arduino-1.8.5, main-bundle |
| Python | Bundled runtimes `ppy-basic/advance/ml`, Jupyter notebook, pylint | V (paths) / I | log, resources |
| Media | ffmpeg, lottie, scratch-paint | V | resources, scripts |
| Analytics | Mixpanel, Firebase, Google Analytics | V (storage) | `ev_a79f6fd8` storage |
| Persistence | electron-store, localStorage, IndexedDB | V/I | storage, deps |

## Recommendations for our independent IDE (design choices, not observations)
- **Electron + React + TypeScript**, with Vite for the renderer. Load the UI from `file://` or a custom protocol instead of an open localhost port. Turn on the hardened fuses (RunAsNode off, ASAR integrity on, OnlyLoadAppFromAsar on). Use `contextIsolation` with a typed preload API instead of 344 untyped channels.
- **Google Blockly** (Apache-2.0, current) with our own block definitions and generators: Arduino C++, MicroPython, Python. Scratch-style looks are available through Blockly's zelos renderer.
- **Monaco** for editable code, with a "blocks → code (read-only)" vs "code-only" mode, as PictoBlox does.
- **arduino-cli** (instead of the deprecated arduino-builder) for compile, upload, core and library management. Board definitions are data-driven (fqbn, upload protocol, toolbox).
- **serialport** in the main process for the Serial Monitor and live mode, behind a typed service.
- **Project format:** zip with `project.json` (our schema: workspace XML/JSON, board, extensions, version) plus assets and a thumbnail. Optional `.sb3` import is a later step.
- **Extensions:** a manifest-driven registry (blocks JSON + generator module + toolbox category + required libraries + supported boards). This lets Tariro boards and sensors be added as data.
