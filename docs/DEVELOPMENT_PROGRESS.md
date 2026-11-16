# Development Progress

## 2026-11-15 — Phase 1–2 (REA reconnaissance) complete
- REA 6.9.0 initialised and verified against live PictoBlox 9.0.0 (extracted .deb, isolated profile, CDP :9333, Node inspector :9334).
- 12 REA screenshots, page/DOM/accessibility Evidence, fuse Evidence, runtime-target Evidence, exported REA bundle (`evidence/rea_session_bundle.json`).
- Reports written: REA_REPORT, REA_INTERACTION_LOG, REA_COMPONENT_MAP, REA_FEATURE_MATRIX, REA_RUNTIME_ANALYSIS, REA_TECHNOLOGY_ANALYSIS.
- REA_VALIDATION_REPORT: not started (no implementation yet).

## 2026-11-15 — Phase 3 (design) draft v0.1
- `IDE_DESIGN.md`: scope (v1 upload-first), stack, process architecture, monorepo layout, board/extension models, sectioned Arduino codegen, arduino-cli hardware services, `.tsp` project format, UI layout, security baseline, test strategy, milestones M0–M6.
- `design/core-types.ts`: BoardDefinition, ExtensionManifest, Emitter/EmitContext, ProjectFileV1, StudioApi IPC contract (type-checks under `tsc --strict`).
- Grounded in the Tariro BOM (ATmega328P + CH340C + TB6612FNG) and the Starter/Robotics/IoT kit contents.
- Decisions confirmed (design v0.2): upload-first v1 (live mode v2, no sprite stage); file snapshots, not SQLite; Tariro = Uno defaults with TODO onboard pins; Windows + Linux equal priority; name "Tariro Studio".
- Still open (non-blocking for M0): Tariro pinout, Malkon ESP32 module, colour sensor model, brand assets.

## 2026-11-15 — M0 complete (`tariro-studio/`)
- npm-workspaces monorepo: `packages/core` (product identity, zod-validated typed IPC contract, shared types) and `packages/app` (Electron 44 main, sandboxed CJS preload, React 19 renderer via electron-vite 6 / Vite 8).
- Security: `app://studio` custom protocol with a path-traversal guard, no localhost server, strict CSP, sandbox and contextIsolation, trusted-sender IPC check, permission requests denied, navigation and new windows blocked, hardened fuses in `electron-builder.yml`.
- Quality: ESLint (typescript-eslint), `tsc -b` strict, Vitest 9 tests (IPC contract, protocol traversal, product identity), Playwright e2e (window opens, version round-trip, no Node in renderer, `app://` origin). All pass locally.
- CI: `.github/workflows/ci.yml` runs a matrix on ubuntu-24.04 and windows-2025 (lint, typecheck, test, build, e2e). **Not yet run on GitHub:** there is no remote yet.
- REA validation: see `REA_VALIDATION_REPORT.md` §M0.
- Version notes vs. design: React 19 (design said 18) and TypeScript 6.0.3 (typescript-eslint does not yet support TS 7). A single Vite 8.3.5 is pinned through overrides.
- Known environment issue: `npm run package` fails **in this session's scratch folder**. npm redacts the UUID path segments in its own output, and electron-builder then cannot resolve the workspace. Packaging from a normal path worked (`linux-unpacked` verified). This goes away once the project lives in a regular folder.

## 2026-11-15 — M1 complete
- `packages/core`:
  - Board registry: Tariro (Uno defaults, placeholder TB6612FNG pins `confirmed: false`), Arduino Uno, Nano and Mega.
  - Extension registry with per-board filtering.
  - Sectioned Arduino generator working on Blockly's JSON: sections, keyed dedupe, setup/loop layout, operator-precedence parentheses, type inference for variables/params/returns, identifier sanitising, function prototypes, block→line source map, warnings.
- `packages/extensions` (new), first-party packs:
  - **core**: start, forever, waits, millis, map, if/else, repeat, while/until, for, break/continue, logic, maths, text, variables, functions with params and returns. Blockly's built-in block definitions, with our own emitters.
  - **io**: digital/analog/PWM pins with board-aware pin dropdowns, tone, serial print/available/read line.
  - **tariro-board**: motor run/stop, with a `#warning` in the sketch and an IDE warning while the pins are placeholders.
- `packages/app`: Blockly workspace (zelos renderer, own theme, orphan blocks disabled, warnings shown on blocks), board picker, Monaco read-only C++ pane with block→line highlighting and a clickable warnings list, local draft so a reload keeps work (replaced by project files in M3). Blockly media is bundled for offline use.
- Tests: 41 unit/golden tests, 4 Playwright e2e tests (including a real drag-and-drop), and `npm run test:compile`, which builds 8 golden sketches with arduino-cli (all pass). CI installs arduino-cli 1.3.1 + arduino:avr 1.8.7 and runs the compile suite.
- **Deferred from M1 (by design):** Lists blocks (fixed-size C++ arrays) move to M4 with the extension work. Event hats ("when button pressed", "every N ms") also move to M4. ESP32 board support depends on bundling the esp32 core (M4).
- Locally, arduino-cli was taken from the existing Arduino IDE 2.3.7 AppImage; nothing new was downloaded.

## 2026-11-15 — M2 built; real-board check pending
- **core:**
  - IPC contract extended with toolchain and serial invoke channels plus validated main→renderer event channels. The preload bridge (`StudioBridge`) has typed subscriptions.
  - Pure parsers: gcc diagnostics, flash/RAM sizes, avrdude/esptool progress, line→block mapping, USB id→board, friendly failure messages.
- **main:**
  - `ToolchainService`: arduino-cli status, compile and upload. Exclusive jobs, cancellation of the whole process tree, and port release/reopen around uploads.
  - `SerialService`: hot-plug polling, board recognition, monitor connection, friendly errors.
  - CLI resolution order: `TARIRO_ARDUINO_CLI`, then the bundled `resources/arduino-cli/<platform>-<arch>/`, then PATH. An optional bundled offline data directory is supported through a generated config file.
- **renderer:** port picker with auto-select and a board-mismatch hint, Verify/Upload/Cancel with progress, and a dock with Problems (blocks + compiler), Output and Serial Monitor tabs. Compiler errors show on blocks and as squiggles in the code.
- **Tests:** 60 unit/golden tests (13 service tests against a fake CLI and mock port), 8 e2e tests (mock upload, serial echo, compiler error → block, real arduino-cli Verify), plus 8 golden compiles.
- **Open:**
  - Upload to a real board. No board has been connected to this machine yet.
  - Bundling arduino-cli and the offline AVR (and later ESP32) cores into installers is a packaging task (`resources/arduino-cli`, `resources/arduino-data`).
  - Prune the serialport prebuilds for other platforms from installers.

## Still open from Phase 1–2
- [ ] Second REA pass: variables/lists/My Blocks flows, Save/Open (handle native dialogs), Edit/Learn/Connect menus, Ace editability in Upload mode.
- [ ] REA static analysis of renderer chunks (`scratchvm_.js`, `common_.js`) for the extension/codegen structure, with a raised client deadline.
- [ ] Hardware pass with a real Arduino Uno / ESP32 / Tariro board connected: detection, upload log, Serial Monitor, firmware/live mode.
- [ ] Decide product scope for v1 (see feature matrix P1 column) and Tariro board specs (MCU, fqbn, pinout).

## 2026-11-15 — M3 complete
- Done:
  - `.tsp` format in core: zip + zod schema + migration, refusing files from newer versions.
  - ProjectService: only granted paths, atomic save, autosave every 30 s and on blur, crash recovery, recent list.
  - IPC for projects, the close guard and OS "open with".
  - Examples moved into `packages/extensions/src/examples.ts`.
  - Renderer: File menu with shortcuts, project name, unsaved dot, Save/Don't save/Cancel guard, recovery dialog, toasts, thumbnails captured by main.
  - Tests: 79 unit tests and 13 e2e tests passed, including a SIGKILL crash followed by recovery.
- Fixed during REA validation:
  - A fresh project was marked dirty in dev: load vs edit changes are now told apart, and starter blocks have stable ids.
  - The dialog backdrop sat under Monaco: z-index raised.
- The dirty-after-New report from the dev build came from a dev session corrupted by hot reload (a React "hooks order" error after editing a hook). A clean production run shows New, Don't save and opening an example all leaving the project clean. Safeguard added: a disposed Blockly workspace can no longer report changes. The e2e test now asserts the project is clean after New.
- REA confirmed crash recovery in a real dev session: after the killed session, the next start offered "Recover your work?".

## 2026-11-15 — Boards added from the Malkon pinouts
- **Tariro (Malkon SMRS v0):** motor pins confirmed (INA D4, ENA D5, INB D7, ENB D6). The placeholder `#warning` is gone. The motor emitter supports direction+enable wiring (SMRS) and two-input wiring (plain TB6612FNG breakouts).
- **New boards:**
  - **Malkon One:** Uno-compatible ATmega328P with CH340.
  - **Malkon ESP32 (ESP32-S3):** `esp32:esp32:esp32s3`, offered as GPIO numbers with a "pins unconfirmed" note.
- **Tests:** golden examples now also compile for the Malkon One, 10/10 with arduino-cli. Unit tests cover both motor wirings and an unconfirmed-pin board.
- **Not yet verified:**
  - ESP32-S3 compile and upload: the esp32 core is not installed here.
  - IR, buzzer and RGB pin numbers: not in the pinout images, so there are no blocks for them yet.

## 2026-11-15 — M4: kit extension packs, extension library, ESP32
- **New packs** (`packages/extensions/src`), each with blocks, Arduino emitters and a toolbox category:
  - **Sensors:** button, analog level for the potentiometer, LDR, soil, water and rain sensors, IR/PIR/sound/rain detectors, DHT11/22, HC-SR04, TCS3200 colour sensor, and the MPU6050 read over raw I²C (no library).
  - **Outputs:** servo (Servo on AVR, ESP32Servo on ESP32), relay/pump (starts switched off), traffic-light module, 7-segment digit, RGB LED.
  - **Displays:** I²C LCD 16×2, SSD1306 OLED.
  - **Bluetooth:** HM10 (SoftwareSerial on AVR, Serial1 on ESP32).
  - **Wi-Fi:** connect, status, IP address and HTTP GET. ESP32 only.
- **Libraries:** pinned per extension and per board family. The generator reports the libraries a program needs, and Verify/Upload installs missing ones first, with a clear message when offline.
- **Extension library:** the "＋ Extensions" dialog adds or removes packs per project (saved in the `.tsp` file). Packs that don't fit the board are disabled, and packs whose blocks are in use are locked. Kit examples turn on their own packs.
- **Examples (9 new):** pedestrian crossing, sensor report, weather station, obstacle avoider, colour sorter, tilt alarm, Bluetooth car, smart garden, Wi-Fi hello. Every kit component appears in at least one.
- **Compile tests:** every example on every listed AVR board compiles with arduino-cli, with pinned libraries installed by the test as the IDE does. Boards whose core is missing are reported as skipped; set `TARIRO_REQUIRE_ALL_CORES=1` to make that a failure.
- **ESP32:** esp32 core 3.3.10 is installed, and the three ESP32 examples compile for the Malkon ESP32-S3. An interrupted first install had left truncated support files; those were repaired.
- **arduino-cli for development** now lives in `tariro-studio/resources/arduino-cli/linux-x64/` (gitignored). That is the bundled location the app already checks, so dev runs find it without `TARIRO_ARDUINO_CLI`.
- **CI:** the GitHub workflow installs only the AVR core, so the ESP32 compile cases show as skipped there. Install esp32:esp32@3.3.10 and set `TARIRO_REQUIRE_ALL_CORES=1` to enforce them.

## 2026-11-15 — M5 complete
- **Code mode:** "Edit as code…" converts a blocks project one way into hand-edited C++ (`mode: 'code'` in the `.tsp` file). Monaco becomes editable, the block workspace is hidden, and libraries come from the project's extensions.
- **Plotter:** new dock tab that charts numbers from the serial text ("25", "10, 20" or "temp:25, light:60"), keeping the last 300 samples.
- **Translations:** `renderer/src/i18n` holds the English catalogue and `t()`, with fallback and a consistency test. File menu, dock and the new M5 strings use it; the rest of the UI is still hard-coded English.
- **Tests:** 126 unit tests and 18 e2e tests. The e2e expect timeout is now 15 s, after two older tests timed out once under machine load and passed 6/6 on rerun.
- **Not done in M5:** Lists blocks and event hats, moved out of M4 earlier, are still open.
