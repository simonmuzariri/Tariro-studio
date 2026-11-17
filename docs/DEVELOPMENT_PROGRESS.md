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


## 2026-11-16 — M6 part 1: MicroPython (Firmata live mode and BLE not started)
- **Generator:** `generateMicroPython` in `packages/core` turns the same block workspace into a Python program (module-level setup, `while True:` for the forever block, `global` declarations inside functions, merged imports, source map).
- **Emitters:** Python forms for the built-in blocks, Pins, Serial and Wi-Fi. Blocks from the sensor, output, display and Bluetooth packs become a comment plus a Problems entry.
- **Upload:** `MicroPythonService` in main writes `main.py` through the raw REPL in 256-byte chunks and soft-resets the board. The Serial Monitor is released first and reopened after.
- **UI:** Language picker for boards that support MicroPython, "▶ Run on board" instead of Verify/Upload, Python highlighting, export as `.py`. The project file stores `language`.
- **Menu bar:** now fits a 1366 px window with the extra picker (found by REA).
- **Tests:** 144 unit tests and 19 e2e tests pass. Generated Python is syntax-checked with `python3`.
- **Not verified:** upload to a real ESP32 with MicroPython firmware. Only a simulated board has been used.
- **Still open from M6:** Firmata live mode, Bluetooth (HM10) connection from the PC. Older open items: Lists blocks, event hats, ESP32 header-to-GPIO mapping, IR/buzzer/RGB pins.

## 2026-11-16 — M6 part 2: live mode over Firmata (BLE not started)
- **Protocol:** `packages/core/src/live/firmata.ts` has a Firmata parser and `FirmataBoard` (pin modes, digital/PWM/servo writes, digital and analog reads with reporting, firmware handshake, analog pin mapping, reset). Pure TypeScript with injected timing.
- **Interpreter:** `live/interpreter.ts` runs the Blockly JSON directly: variables, functions with parameters and return values, loops with break/continue, cancellable waits, and a pre-flight check (`checkLive`). Extensions supply `live` handlers next to their code emitters.
- **Blocks that run live:** all built-in blocks, Pins (digital, PWM, analog read), "serial print" (shown in Output) and the Tariro motors. Not yet: tone, serial input and the kit packs; ESP32 boards.
- **Main process:** `LiveService` owns the serial port at 57600 baud; the renderer sends typed pin operations over IPC (`live:connect`, `live:io`, `live:disconnect`, `live:install-firmware`). The Serial Monitor is released and reopened around a live session, and an upload ends one.
- **Firmware:** the app compiles and uploads the Firmata library's own StandardFirmata example (Firmata 2.5.9), so no firmware source is copied into this repo.
- **UI:** "⚡ Run live" / "■ Stop live", live status in the menu bar, running-block highlight, firmware install prompt, live problems in the Problems tab.
- **Simulated board:** `SimulatedFirmataBoard` (core) backs the unit tests and the dev-only mock port (`TARIRO_SERIAL_MOCK=firmata`), which logs every pin write to Output.
- **Tests:** 170 unit tests and 22 e2e tests pass.
- **Not verified:** anything on a real board.
- **Still open from M6:** Bluetooth (HM10) connection from the PC.

## 2026-11-16 — First test on a real board (Tariro / Malkon SMRS)
Board on `/dev/ttyACM0`, Linux. Its USB bridge reports as "FIREPHX USB SER", id `0843:5740` (USB CDC, kernel driver `cdc_acm`), not the CH340 assumed so far. The id is now in the Tariro board definition, and the app labels the port "Tariro Robotics (Malkon SMRS)".

| Check | How | Result |
|---|---|---|
| Upload with arduino-cli | Blink generated from the blocks example, `arduino:avr:uno` | PASS: avrdude found an ATmega328P (signature 1E 95 0F), 924 bytes written |
| Serial, board → PC | Blocks program printing a counter and A0 every 0.5 s, read with `cat` and inside Electron's runtime | PASS: lines arrive every 0.5 s |
| Serial, PC → board | Same program echoes a received line | PASS: "echo:hello 5000" came back |
| Upload from the app | Dev build, Blink example, Upload button | PASS: "Uploaded! Your program is running on the board." |
| Live firmware install | Run live → "Install the live firmware?" → confirm | PASS: StandardFirmata compiled (13322 bytes, 41 %) and uploaded |
| Live mode | Blink example running live | PASS from the PC side: handshake answered (Firmata 2.5), running block highlighted, A0 read 963/815/810 through Firmata, A0 mapped to pin 14. Evidence: `REA_SCREENSHOTS/HW_live_mode_real_tariro.png` |
| Stop live | Stop button | PASS: "Live: stopped. The pins are switched off." |

| Motors, live mode | "Drive forward and back" example run live for about 6.5 s (both motors forward at 60 % for 2 s, stop, backward at 40 %), then Stop | PASS from the PC side: commands sent on INA 4 / ENA 5 / INB 7 / ENB 6 and "Live: stopped. The pins are switched off." **Confirmed by the user watching the robot:** both wheels ran forward, stopped, then ran backward, as the blocks say. This confirms the SMRS motor pins and directions on real hardware |
| Firmware lost after an ordinary upload | Blink was uploaded from the app between live runs | PASS: the next live start correctly reported no Firmata and offered to install it again |

Not checked: whether the LED on pin 13 was seen blinking (not confirmed by eye), motors from an uploaded program (only live mode was tried), MicroPython, Windows.

Findings:
- Opening the port restarts the board, as expected for an Uno-type board.
- Whole numbers print with two decimals ("count:1.00") because block variables are `double`. Worth fixing for learners.
- The connected firmware showed as "sketch 2.5" because Firmata reports the sketch file name; it now shows "StandardFirmata 2.5".
- A standalone test script under Node 26 received no serial data unless something else touched the port. The same read works under Electron's runtime (Node 24), which is what the app uses, so the app is not affected. Do not use Node 26 for serial test scripts.
- ModemManager is active on this machine and treats the port as a modem candidate. It did not break anything in these tests.

## 2026-11-16 — Brand: Tariro Studio logo and red/black theme
- **Logo:** supplied by Omorfo Tech Labs (original kept in `docs/design/brand/`). The menu bar shows it in place of the text name; a variant with the black parts turned near-white is used in the dark colour scheme.
- **App icon:** `packages/app/build/icon.png` (the "R" mark on a white rounded square), picked up by electron-builder. Not yet seen in a built installer.
- **Colours:** the teal is gone. The menu bar is light (dark in the dark scheme) with a red underline; the main action (Upload / Run on board) and dialog confirm buttons are brand red `#d4000c` (white text on it is 5.6:1); Tariro blocks use the same red.
- **Output tab:** the app's own status lines are bold neutral text, not the brand colour, so "Compiled successfully" does not look like an error.
- **Checked:** REA capture in the dark scheme (`REA_SCREENSHOTS/BRAND_theme_dark.png`), light scheme by emulation, 175 unit and 22 e2e tests pass.

## 2026-11-17 — Interface redesign (design system, dark default, card layout)
Scope: a visual and interaction overhaul of the existing React renderer. No feature was removed; code generation, toolchain, serial, live mode and project files are untouched. The layout follows the product mock-up supplied by Omorfo Tech Labs.

- **Design system** (`renderer/src/styles.css`): tokens for colour, type, spacing, radius, shadow and motion. Dark is the default; a light theme switches the tokens (`data-theme`), and the choice is remembered. Inter for the interface and JetBrains Mono for code, both bundled (no network). Lucide icons throughout; no emoji glyphs remain in the interface. Motion is short and switches off under "reduce motion".
- **Title bar:** our own dark bar with the logo, the project name (editable in place), the unsaved-changes dot, a theme switch and minimise / maximise / close. The window is frameless on Windows and Linux; macOS keeps its own buttons. Closing still goes through the unsaved-changes guard.
- **Toolbar:** File, Extensions, Board, Language (where offered), Port, then status, Verify, Upload and Run live on the right. Upload is the red primary action.
- **Toolbox:** still Blockly's toolbox, with our own category row (an icon tile per category in its colour), red highlight for the selected category, hover states, a collapse-to-icons mode with tooltips, and a block search that fills the flyout with matching blocks ready to drag.
- **Workspace:** dotted grid, block depth shadows, clearer snap highlight, and a floating vertical control pill (undo, redo, zoom in, zoom level/reset, zoom out, fit) above the bin. Blockly's own zoom buttons are off; wheel and pinch zoom remain.
- **Code panel:** Monaco with our own dark and light themes, JetBrains Mono, current-line highlight, folding, indent guides, slim scrollbars and a tab-style header.
- **Bottom panel:** icon tabs with an animated active marker, a status badge (Ready / Compiling… / Uploading… / Running live / Failed) driven by the real toolchain and live state, icons on our own output lines, error and warning icons in Problems, and a hide/show toggle.
- **Layout:** panels are rounded cards; the code column and the bottom panel resize with splitters (mouse or arrow keys) and the sizes are remembered. A status bar shows board, port, live state, problem counts, language and version.
- **Shortcuts:** Ctrl+R Verify, Ctrl+U Upload, Ctrl+B toolbox, Ctrl+J bottom panel, Ctrl+F block search, plus the existing File shortcuts. Electron's default menu is removed off macOS so Ctrl+R no longer reloads the window.
- **One tooltip layer** for the whole app (`data-tip`), drawn above everything so it is never clipped.
- **New dependencies (bundled, dev-time):** `lucide-react`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`.

Checks:
- REA captures of the running dev build at 1366×736: `UI_redesign_pass1.png`, `UI_redesign_pass2.png` (category open, real Verify compiled), `UI_redesign_uploading.png`. Defects found by REA and fixed: yellow outlines on every block connection (a CSS rule hit Blockly's hidden highlight paths), "Edit as code" and the panel toggle pushed off a narrow code column, the search box too narrow, the bin too dark.
- Emulated 1920×1080 (light) and 1600×900 (dark): no page scrolling, toolbar fits. These two are my own CDP captures, not REA evidence.
- 175 unit tests and 29 end-to-end tests pass (7 new ones cover theme, search, collapse, zoom/undo, splitters, window buttons, Ctrl+R and the badge).

Not verified / known limits:
- **Real board today:** uploading from the new interface failed with "The board did not answer". A direct `arduino-cli upload` failed the same way, so this is not caused by the redesign: the USB bridge (0843:5740) is detected but the microcontroller does not reply. Yesterday the same board worked. Needs a look at the board (power, cable, socket).
- The frameless window has only been run on this Linux desktop. Windows and macOS title-bar behaviour is untested.
- Tooltips do not appear on disabled buttons (the browser sends them no hover events).
- The mock-up's Blocks / Python / Arduino C++ tabs above the workspace, and its settings, help and account buttons, are not built: nothing behind them exists yet, and controls that do nothing are not allowed by the project rules.

## 2026-11-17 — Platform expansion: Phase 1 (assessment and plan)
The inspection, architecture assessment, roadmap, open decisions and acceptance-criteria status are in `docs/EXPANSION_PLAN.md`. No expansion feature is built yet.

## 2026-11-17 — Expansion Phase 2 (slices 2a–2e): Basic Components, encoders, actuators, arm
Details and the verification table are in `docs/EXPANSION_PLAN.md` (section 9, "Phase 2 record").
- New pack `basic` (Tariro Basic Components) with rotary encoder and PID blocks; `actuators` pack extended with DC motor drivers, servo motion, steppers and a servo arm; both built in on every board.
- Boards declare `interruptPins`; encoder set-up warns about pins that cannot interrupt.
- Seven new examples (now 19). All 42 example-and-board combinations compile with the real toolchain, AVR and ESP32.
- 219 unit tests and 31 end-to-end tests pass.
- Nothing in this slice has run on real hardware: no encoder, driver board, stepper or arm was connected, and the Tariro board was not answering uploads on this day.

## 2026-11-17 — Simulation Lab, first slice (solver, simulated board, Simulator tab)
Details in `docs/EXPANSION_PLAN.md` ("Simulation Lab record").
- A DC circuit solver (resistors, sources, LEDs) and a simulated 5 V AVR board that runs block programs through the same interpreter as live mode.
- The circuit is worked out from the blocks; a new Simulator tab beside the code shows the parts, live readings, controls for buttons, switches and potentiometers, and how to wire the same thing on a breadboard.
- 249 unit tests and 34 end-to-end tests pass.
- Not built yet: the 3D workbench, free placement and wiring of parts, instruments with probes, servo/encoder/robot models, ESP32 and Pico.

## 2026-11-17 — Simulation Lab: 3D workbench (slice 7c)
Details in `docs/EXPANSION_PLAN.md` ("Simulation Lab record, slice 7c").
- A Blocks / Workbench switch in the toolbar. The workbench is a 3D breadboard and board where learners place LEDs, resistors, buttons, switches, potentiometers and buzzers and wire them to pins; "Build from blocks" lays out what the program uses.
- Real breadboard connectivity decides what is joined; the block program runs on the circuit as built, and mistakes are explained.
- The bench is saved in the project file. three.js 0.186.1 is loaded only when the workbench opens.
- 258 unit tests and 37 end-to-end tests pass.
- Not yet: more 3D parts (sensors, motors, servos), instruments with probes, undo on the bench, testing on other graphics hardware.

## 2026-11-17 — Simulation Lab: virtual instruments (slice 7e)
Details in `docs/EXPANSION_PLAN.md` ("Simulation Lab record, slice 7e").
- An Instruments tool on the workbench: multimeter (volts, ohms with the power off, amps through a part), two-channel oscilloscope with frequency and duty, and a logic view of the pins.
- Probes are placed by clicking holes, rails or pins in 3D, or chosen from lists.
- 267 unit tests and 40 end-to-end tests pass.
- Limits: no scope trigger, 20 ms sampling, PWM shown as its average voltage.

## 2026-11-17: Phase 3, slices 3a–3c
- Experience levels (Beginner / Intermediate / Advanced) filter the toolbox and block search.
- Live mode and MicroPython now cover the Basic Components and Actuators packs (MicroPython checked against stub hardware, not a real ESP32).
- New Python environment: Python 3.14 on the PC (Pyodide, offline), with a `tariro` module that drives the board over the live-mode link.
- Tests: 299 unit, 43 end-to-end. REA: `P3_level_beginner.png`, `P3_python_environment.png`.

## 2026-11-17: Phase 3, slices 3d–3e
- Creative Studio: stage, sprites, costumes, backdrops, synthesised sounds and event-driven blocks, with original Tariro characters and backdrops. Saved in the project.
- Toolbar switch between Blocks, Workbench, Creative and Python on one project file.
- Tests: 311 unit, 44 end-to-end. REA: `P3_creative_studio.png`.

## 2026-11-17: Redesign, version 3 (light, PictoBlox-style) and Stage / Upload modes
- Light, colourful style by default (dark still in the title bar): brand red title bar with the logo on a white badge, white toolbar and cards on a soft blue-grey ground, Nunito type, solid colour-coded actions (green Verify, red Upload, purple Run live).
- Our own icon set (`ui/icons.tsx`, filled two-tone, drawn for Tariro); Lucide and Inter removed.
- Toolbox as a narrow column of colour circles with names under them; search widens over the flyout; Extensions moved to an Add button under the categories. Brighter block colours, each with at least 3:1 contrast for the white text.
- Coding modes replace the separate tabs: Stage (sprites and the board together, run from this computer), Upload (blocks onto the board, with the Workbench toggle) and Python. Creative Studio is now Stage mode; its toolbox includes the board's blocks, driven over the live-mode link with readings refreshed about 30 times a second.
- Tests: 316 unit, 45 end-to-end (one new: a sprite program switches the mock board's LED). Two existing end-to-end tests failed once each under full-suite load and passed on reruns (timing, not behaviour).
- REA: `UI3_upload_mode.png`, `UI3_stage_mode.png`.

## 2026-11-17: Tariro, the mascot, as the main sprite
- The character sheet supplied by Omorfo Tech Labs (`docs/design/brand/tariro-character-sheet.webp`) is cut into 42 costumes by `docs/design/tools/cut-character-sheet.py`: 34 full-body poses in 15 movements (walk 5, run 4, jump 4, idle 2, talk 4, think, point, teach 2, laptop, celebrate 2, sad, crouch, fall 2, get up 2, wave 2) and 8 face expressions. Labels removed; every full-body pose shares one canvas with the feet on the same line, so changing pose keeps her standing in place.
- Tariro is the starter sprite in Stage mode (waves and says hello on the green flag). The robot stays in the library as "Robot"; "Tariro face" is a separate character.
- New block "next costume in [walk ▾]" animates one movement.
- Known: two of the eight faces keep a few pixels of the neighbouring face's hair at one edge (the faces touch in the sheet).
- Tests: 317 unit; Stage end-to-end tests pass. REA: `UI3_stage_tariro.png`.

## 2026-11-17: Toolbar: Board and Connect, coding modes on the far right
- Toolbar order: File · Board · Connect · experience level · (language, Workbench in Upload mode) · build status, Verify / Upload / Run live · Stage | Upload | Python on the far right.
- Connect replaces the port list: click it and choose the USB port the board is on. Until then nothing uses the board (Upload and Run live stay disabled). The chosen port is remembered on this computer and used again when that board is plugged in; the menu also offers Disconnect. The app no longer picks a port by itself.
- Tests: 317 unit, 46 end-to-end (new: toolbar order, remembering the port, Disconnect). REA: `UI3_connect_menu.png`.

## 2026-11-17: Board menu and a compact toolbar
- The board picker is now a "Board" button (it no longer shows a board's name, since the Tariro is not always the board in use); it opens a list of every board with its maker, the current one ticked. The board in use is shown in its tooltip and the status bar.
- Toolbar controls share one height (32 px), 15 px icons and even spacing; the toolbar is 50 px tall.
- Tests: 46 end-to-end pass. REA: `UI3_toolbar_compact.png`, `UI3_board_menu.png`.

## 2026-11-17: Phase 4, slices 4a–4c (camera, image classifier, vision blocks)
- Camera with consent, picker and "Camera on" indicator; only the camera is ever allowed.
- "Teach AI": record pictures per class, train on this computer with MobileNet v2 features (bundled, offline), honest held-back accuracy, live confidence; saved in the project.
- AI Vision blocks in Stage mode, including "when AI sees" and the camera picture on the stage.
- Tests: 324 unit, 47 end-to-end. REA: `P4_ai_classifier.png` (fake camera).
- Next: 4d colour, QR and marker detection; 4e playground; 4f audio and pose.

## 2026-11-17: Phase 5, slice 5a (safety layer and emergency stop)
- The AI image classifier was confirmed working with a real webcam by Omorfo Tech Labs.
- Safety layer in the main process for every board command (live, Stage, Python): clamps, motor speed limit (under Connect), bad-pin and flood refusal, log in Output, watchdog, latched emergency stop (E-STOP button and Esc, Reset banner).
- Tests: 333 unit, 48 end-to-end. REA: `P5_safety_running.png`, `P5_safety_estop.png`.

## 2026-11-17: Phase 5, slices 5b–5c (vision drives the robot; autonomy blocks)
- Drive block for the Tariro (Upload, live, Stage); AI fail-safe stops the motors when recognition goes silent; "AI traffic-light car" Stage example.
- Autonomy blocks (Upload): drive until obstacle, follow a line, drive N cm straight and turn N° with encoders; two new examples.
- Tests: 350 unit, 49 end-to-end, 45 compile combinations. REA: `P5_ai_traffic_light_car.png`.

## 2026-11-17: The real Malkon SMRS board on the workbench

- With the Tariro board selected, the workbench now draws the Malkon SMRS in 3D (`bench/smrsModel.ts`), adapted from Omorfo Tech Labs' own board model, with the board photo as the PCB top (`assets/boards/malkon-smrs.jpg`). Pointing at a part names it (motor terminals, regulators, jacks, jumpers).
- Pins come from one shared map in core (`sim/smrs.ts`), so wires and probes plug into the right header: D13 and D12 (top left), D10 and D11 (servo header), D2 and D3 (top right), and A0–A5 with their G row and 5V row. Every 5V and GND pin can be used; they are the same pin electrically (`pin:GNDx2`… → GND).
- Not wireable yet, because the pinout does not confirm them: the front row of the servo header, the serial, ESP and ICSP headers, and the IR, buzzer and RGB jumpers. D4–D7 drive the motor driver. On this board, "Build from blocks" leaves out parts on pins that have no header pin (for example pin 9), and says so.
- Tests: 4 new layout tests; the bench e2e tests use header pins (10 and 3 in place of 9 and 7). Screenshot: `docs/REA_SCREENSHOTS/P5_bench_smrs.png`. Not checked against the physical board.

## 2026-11-17: The Malkon One on the workbench

- With the Malkon One selected, the workbench loads Omorfo Tech Labs' 3D model of the board (`assets/boards/malkon-one.glb`, 2.7 MB, from the user; `bench/malkonOneModel.ts`). It is turned a quarter so the digital header faces the breadboard, D0 on the left. Pointing at a part names it (the labels come from the model).
- Pins (`core/src/sim/malkon-one.ts`), from the model's header positions and the pinout: D0–D13, GND, SDA/A4 and SCL/A5 on the digital header; the 5V and G sensor columns beside it; A5…A0 with their G and 5V columns; and GND, GND and 5V on the power header. SDA and SCL are A4 and A5 (`pin:A4x2`, `pin:A5x2`). Not wireable: AREF, Vin, 3.3 V, Reset, IOREF, N/C, the ESP RX/TX pins and the IR, buzzer and RGB jumpers.
- Extra pins of the same signal are now named `<pin>x<n>` on both real boards (`GNDx2`, `A4x2`).
- The page's content security policy now allows `blob:` images and fetches: the glTF loader decodes the model's built-in texture through a blob URL (without it the board drew white). If the model cannot load, the generic board is drawn with the same pin positions.
- Tests: 2 new layout tests and 1 e2e test (`BENCH: the Malkon One …`). Screenshot: `docs/REA_SCREENSHOTS/P5_bench_malkon_one.png`.
