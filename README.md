# Tariro Studio

A visual programming IDE for the Tariro robotics, electronics and IoT kits by Omorfo Tech Labs.
The design lives in `docs/IDE_DESIGN.md`, the platform expansion plan in `docs/EXPANSION_PLAN.md`, progress in `docs/DEVELOPMENT_PROGRESS.md`, and the reverse-engineering reports and evidence it is based on in `docs/REA_*.md`, `docs/REA_SCREENSHOTS/` and `docs/evidence/`.

**Status: milestone M6, parts 1–2.** Blocks with live Arduino C++, or hand-edited C++ in code mode. MicroPython for the ESP32 board. Live mode for AVR boards: the blocks run on the PC and drive the board over Firmata. A Simulator tab and a 3D workbench run the blocks on a virtual circuit: build it on a breadboard or let the blocks lay it out. A multimeter, an oscilloscope and a logic view measure the virtual circuit. Verify, Upload, Serial Monitor and Plotter through arduino-cli. Project files with autosave and crash recovery. Basic Components (with rotary encoders), Actuators and kit extension packs, with 19 examples. The interface was redesigned on 2026-11-17 (dark by default, light theme, resizable panels). Checked on a real Tariro (Malkon SMRS) on Linux: upload, serial both ways, and live mode including the motors. Not yet checked on real hardware: the other boards, MicroPython, Windows. Bluetooth from the PC is not built.

## Layout
| Path | Contents |
|---|---|
| `packages/core` | Pure TypeScript domain core: product identity, typed IPC contract (zod), shared types, board definitions, extension registry and the sectioned Arduino code generator. No Electron or DOM. |
| `packages/extensions` | First-party block packs: built-in `core`, `io`, `tariro-board`, plus the kit packs `sensors`, `actuators`, `displays`, `communication`, `iot`: Blockly block JSON, toolbox categories and Arduino emitters. Golden programs and generator tests live in `test/`. |
| `packages/app` | Electron main (`src/main`), sandboxed preload (`src/preload`), React renderer (`src/renderer`), Playwright e2e (`e2e`). |

## Commands
Run from the repo root, with Node 22 or later.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run ci
```

```bash
npm run test:e2e
```

```bash
ARDUINO_CLI=/path/to/arduino-cli npm run test:compile
```

```bash
npm run package
```

- `npm run dev` starts the app with hot reload.
- `npm run ci` runs lint, typecheck, unit tests and build.
- `npm run test:e2e` builds, then launches the app under Playwright.
- `npm run test:compile` compiles every golden sketch with a real arduino-cli. It needs the `arduino:avr` core and finds the CLI through `$ARDUINO_CLI` or `PATH`.
- `npm run package` creates installers in `packages/app/release` (NSIS on Windows; deb and AppImage on Linux).

Electron 44 downloads its binary on first use. Run `node node_modules/electron/install.js` to fetch it ahead of time.

## Security baseline
- The renderer is sandboxed, with `contextIsolation` on, `nodeIntegration` off and a strict CSP. It is served from `app://studio/` rather than a localhost HTTP server.
- The renderer can only call `window.studio`. Main validates every IPC argument and result against the zod contract in `packages/core/src/ipc.ts`, and rejects calls from foreign frames.
- Packaged builds flip the Electron fuses (`electron-builder.yml`): RunAsNode off, ASAR integrity on, OnlyLoadAppFromAsar on.
- `TARIRO_STUDIO_REMOTE_DEBUG_PORT` opens a CDP port for REA inspection. It works in unpackaged builds only.

## Hardware and toolchain settings (environment variables)
| Variable | Purpose |
|---|---|
| `TARIRO_ARDUINO_CLI` | Path to arduino-cli. Without it, the app uses the bundled copy in `resources/arduino-cli/<platform>-<arch>/`, then `arduino-cli` on PATH. |
| `TARIRO_ARDUINO_DATA` | An arduino-cli data directory (cores and libraries) to use instead of the default, for offline installs. |
| `TARIRO_SERIAL_MOCK=1` | Development and tests only: a virtual Tariro on `/dev/ttyMOCK0` that echoes what you send. |
| `TARIRO_SERIAL_MOCK=firmata` | Development and tests only: the virtual port is a simulated board running StandardFirmata, for live mode. Its pin writes appear in the Output tab. |

On Linux, uploading needs your user in the `dialout` group. The app explains this if the port refuses access.

## Adding an IPC call
1. Add the channel and its zod schemas to `ipcContract` in `packages/core/src/ipc.ts`.
2. Implement the handler in `packages/app/src/main/index.ts`. `HandlerMap` makes a missing handler a compile error.
3. Expose it in `packages/app/src/preload/index.ts` and extend the `StudioApi…` type.

## Adding blocks
1. Add a `BlockSpec` (Blockly JSON) and an emitter to an extension in `packages/extensions/src`. Emitters return inline code and `contribute()` keyed snippets to the `includes`, `globals`, `functions` and `setup.init` sections.
2. Add the block to the extension's toolbox category.
3. Cover it with a generator unit test. If it is part of a typical program, also add it to a golden program in `test/golden/programs.ts`, then run `npx vitest run -u` and review the new `.ino` snapshot.
