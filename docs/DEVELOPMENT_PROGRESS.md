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

## 2026-11-18: A DC motor (TT gear motor with wheel) on the workbench

- New bench part **DC motor**: Omorfo Tech Labs' model of the yellow TT gear motor with its 65 mm wheel (`assets/parts/tt-motor-wheel.glb`, from the user; `bench/motorModel.ts`, loaded once through `bench/glb.ts`). It lies on its side in front of the breadboard, wheel on top; its **red wire (+)** and **black wire (−)** plug into two neighbouring holes. The model's own loose leads are hidden and the bench draws the two wires.
- Simulation (`core/src/sim/circuit.ts`, part kind `dc-motor`): a 33 Ω load, about 150 mA at 5 V while running (back-EMF and stall current are not modelled). It does not turn below 0.8 V; above that its speed follows the voltage across it and its direction the polarity. On the bench the wheel turns at up to 2.5 turns a second.
- Wired straight to a pin it barely turns, and both the motor ("a pin cannot power a motor … use a motor driver or a transistor") and the pin (more than 40 mA) say so.
- With a motor on the bench, the default view widens to include it.
- Tests: 2 new simulation tests; e2e `BENCH: a DC motor wired to 5V and GND turns …`. Screenshot: `docs/REA_SCREENSHOTS/P5_bench_tt_motor.png`.

## 2026-11-18: Motors on the Malkon SMRS motor terminals

- The SMRS's screw terminals are connection points on the bench (`MA1`/`MA2` = A01/A02, `MB1`/`MB2` = B01/B02, at the side of the terminal blocks), and the onboard TB6612FNG is simulated (part kind `h-bridge`): Motor A from D4 (INA, direction) and D5 (ENA, PWM speed), Motor B from D7 (INB) and D6 (ENB). The driver is powered from 5 V, so the pins carry only logic signals and no pin warning appears. Direction pin HIGH makes A01/B01 the + side (a convention; which way the robot rolls depends on how the motor is wired).
- On the Tariro board a new DC motor goes onto the first free terminal (Motor A, then B) and lies beside the board, its red and black wires in the terminal. Its panel has "Wires go to: Motor A terminal / Motor B terminal / Breadboard holes". "Build from blocks" puts a motor on each terminal for the motor and drive blocks.
- With motors on the terminals, the default view moves to show them.
- Tests: 3 new layout tests (driver direction and speed, Motor B, two motors on one terminal, building from blocks); e2e `BENCH: on the Tariro board, motors go on the Motor A and B terminals and the motor blocks turn them`. Screenshot: `docs/REA_SCREENSHOTS/P5_bench_smrs_motors.png`.
- Wheels turn on the bench while the program runs (fix: only one rim piece of the model was turning, because two labels began with "Wheel"). Up to 2.5 turns a second at full speed; a green curved arrow over the wheel shows forward, an orange one backwards, none when stopped. Measured in a check run at 70 %: Motor A +1.6 turns/s, Motor B (reversed) −1.5 turns/s. The e2e test reads the wheel's angle through the bench's test hook (`wheelTurns`). Screenshot: `docs/REA_SCREENSHOTS/P5_bench_motors_turning.png`.

## 2026-11-18: The robot car chassis on the workbench

- New bench part **Robot car**: Omorfo Tech Labs' chassis model (`assets/parts/robot-chassis.glb`, from the user; `bench/chassisModel.ts`): an aluminium deck 96 × 140 mm about 48 mm off the table, side plates, a ball caster at the front and two TT motors with wheels at the back. It stands behind the breadboard, its front away from the learner.
- With the chassis on the bench, the board moves onto its deck (`boardPlacement` in core: further back and 48.2 mm up), and every pin and wire moves with it; the breadboard stays on the table for sensors and other parts.
- Adding the car on the Tariro board also adds its two motors, wired to Motor A (left, pins 4/5) and Motor B (right, pins 7/6). Their red and black wires come up from under the deck into the board's screw terminals. The chassis's own wheels turn with the program; a straight green arrow over a wheel shows it pushing the car forward, an orange one backwards (each wheel's turning direction is worked out from the model when it loads, so forward on both sides really rolls the car forward).
- Not done yet: the IR sensor, ultrasonic sensor and battery have no mounting places on the car.
- Tests: 2 new core tests (placement on the deck; one chassis only) and e2e `BENCH: the robot car carries the board and its two motors, and the program turns its wheels` (left wheel forward, right wheel backwards, measured). Screenshot: `docs/REA_SCREENSHOTS/P5_bench_robot_car.png`.

## 2026-11-18: The robot car drives; the breadboard is optional

- **The car drives across the bench** while the program runs, from its two wheel speeds as a two-wheeled car moves (`driveCar` in `bench/scene.ts`): wheel surface speed = motor speed × 2.5 turns/s × π × 65 mm; equal speeds go straight, a faster right wheel turns it left, opposite speeds spin it on the spot (track 126 mm). The board, its motor wires and the chassis ride on one group that moves and turns; wires from the table to the board stretch and follow. The view follows the car, keeping the learner's angle. It stays on the table (within 1 m of its start). When the program stops the car stays where it is, as a real one would; "Put the car back" (the car's panel) returns it and the view. Measured in a check run: both motors at 100 % for 1 s → about 0.5 m straight ahead; left 60 %, right 100 % for 1.3 s → a left curve of about 130–156°.
- **Breadboard on or off**: a Breadboard button in the bench toolbar puts it away or brings it back; the choice is saved with the project (`breadboard: false` in the layout; an otherwise empty bench is now kept when the breadboard is put away). It can only be put away when nothing is plugged into it; breadboard parts are greyed out while it is away (the robot car and motors on the board's terminals stay available).
- Tests: e2e `BENCH: the robot car drives forward on the bench, and the breadboard can be put away` (straight drive measured; breadboard refused with an LED on it, then put away and brought back); the car test also checks the spin on the spot (heading) and "Put the car back". Screenshot: `docs/REA_SCREENSHOTS/P5_bench_car_driving.png`.

## 2026-11-18: The bench starts empty; the side panels close

- **Empty at the start**: the learner chooses what goes on the bench. The Parts list has a new "Bench" section with **Board** (the board chosen in the toolbar) and **Breadboard**; each puts it on the bench or away (refused while something is plugged into it). Breadboard parts wait for a breadboard; wiring a leg to a pin waits for the board. Layout fields `board` and `breadboard` (true / false; missing in older projects = shown when something uses it, so saved projects open as before). "Build from blocks" puts the board and, when needed, the breadboard on the bench; "Clear the bench" takes everything off.
- The robot car can be added before the board; putting the board on the car then wires the car's two motors to Motor A and B.
- **The Parts list and the details panel close** (× in their corner) and reopen from small "Parts" and "Details" buttons, so the whole bench is in view while the robot car drives. Each choice is remembered on this computer. The breadboard toggle moved from the toolbar into the Parts list.
- Tests: e2e `BENCH: the side panels close to show the whole bench, and open again`; the bench tests now put the board and breadboard on the bench themselves, and the Blink test checks the bench starts empty and that building fills it. Screenshots: `docs/REA_SCREENSHOTS/P5_bench_empty_start.png`, `P5_bench_car_panels_closed.png`.

## 2026-11-18: Phase 6, slice 6a: Drone Studio (blocks and the flight simulator)

- **Drone mode**: a fourth mode beside Stage, Upload and Python. Blocks on the left (Start, Drone, Control, Operators, Variables, Text, My Blocks); on the right a 3D flight view with Fly / Stop / Land now / Emergency stop / Reset, a Follow camera, telemetry (status, height, battery, heading, distance from the pad, speed, flight time) and the safety limits. A new project starts with a first flight: take off, a 1 m square, land. The block that is running is highlighted.
- **Simulator** (`core/src/drone/sim.ts`, `DroneSim`): the commands of the DJI Tello SDK 2.0 (take off to 80 cm; up/down/left/right/forward/back 20–500 cm relative to where the drone faces; turn 1–360°; flips; speed 10–100 cm/s; emergency), each taking real time; lean into moves; battery use (1 % per 7 s in the air); flight path recorded. A `DroneLink` interface so 6b can put a real Tello behind the same blocks.
- **Safety**: the learner's height limit (default 200 cm) and fence round the pad (default 300 cm) are checked before every move; a move that would break one is refused with the reason and the block is selected. Take-off needs 10 % battery, flips 50 % and 60 cm of height; below 5 % the drone lands by itself. Esc lands the drone; the emergency stop (motors off, the drone falls, as on a Tello) is its own button. The limits are saved in the project (`drone.limits`).
- **Blocks** (`extensions/src/drone.ts`): take off, land, fly direction cm, turn, hover, set speed, flip, emergency, readings (height, battery, heading, distance, x, y, flight time) and "is flying?". They run through the live interpreter (`LiveRun` target `drone`), so loops, conditions, variables and functions work; board blocks are refused in a drone program. The pack is offered to no board, so it never shows in the Arduino toolbox.
- Tests: 6 unit tests (`extensions/test/drone.test.ts`: the square flight and its path, height and fence limits, the take-off/flip/distance rules, turning and readings, auto-landing and the emergency fall, which blocks a drone program may use) and e2e `DRONE: Drone Studio flies the starter square in the simulator and Esc lands the drone`. Screenshot: `docs/REA_SCREENSHOTS/P6_drone_studio.png`.
- Not yet: 6b (a real Tello over Wi-Fi/UDP with telemetry) and 6c (missions, record and replay). No real drone has been flown.

## 2026-11-18: Phase 6, slice 6b: flying a real DJI Tello (verified against a pretend Tello only)

- **Drone Studio** has a **Simulator / Tello (Wi-Fi)** choice. With Tello: join the drone's Wi-Fi (TELLO-…), press Connect (the drone is switched into SDK mode; battery shown), and the same blocks fly it. The first real flight of a session asks the learner to confirm a safety checklist (clear space, guards on, in sight, how to land and stop). Land now (Esc) and Emergency stop work on the real drone; Disconnect lands it first if it is flying.
- **Main process** (`main/services/tello.ts`): UDP text commands to 192.168.10.1:8889 and the state broadcast on 8890; one command in flight at a time (the Tello answers when it has finished), timeouts sized to each command, a keep-alive while idle (a Tello lands by itself after 15 s without a command), "stop" + "land" for Land now, "emergency" for the emergency stop.
- **Safety** (`core/src/drone/tello.ts`, `DroneGuard`): every command passes the guard in the main process, so no program (or AI decision) in the window can get round it. The Tello does not report where it is, so the guard keeps an estimate from the moves it accepted (the same planning as the simulator, `planMove` in `core/src/drone/sim.ts`), corrected by the height and heading the drone reports; it refuses moves past the height limit or the fence, take-off below 10 % battery and flips below 50 % / 60 cm. The drone is told to land if the app stops sending heartbeats (1.5 s), or if it reports being 30 cm above the height limit. The guard logs its last 300 decisions.
- **Tests without a drone**: a pretend Tello (`main/services/fake-tello.ts`, `TARIRO_FAKE_TELLO=1` in development and tests) speaks the Tello protocol on localhost and flies the simulator in real time. 6 core tests (protocol text, state parsing, guard decisions, watchdog), 3 tests of the UDP link against the pretend Tello (a flight with a move refused at the fence and never sent, no drone answering, the watchdog landing and the emergency stop), and e2e `TELLO: a real-drone flight through the safety guard …`. Screenshots: `docs/REA_SCREENSHOTS/P6_tello_checklist.png`, `P6_tello_flight.png`.
- **Not verified on a real Tello.** The protocol follows the Tello SDK 2.0 documentation; a first real flight needs a Tello, open space and supervision. Unknowns to check then: how a real Tello answers "stop" during a long move, and how closely the position estimate follows it.

## 2026-11-20: Phase 6, slice 6c: missions, record and replay

- **Every flight is recorded**, flown by a program or by hand, on the simulator or a Tello (`core/src/drone/flight.ts`: `FlightRecorder`, and `recordingLink`, which wraps any `DroneLink`): the drone's position, heading, tilt and battery about ten times a second, and every command with whether it was carried out (and why not). A "● Recording" badge shows while it records; when the drone is back on the ground the flight appears in **Flights** as "Last flight (not saved)".
- **Pilot pad**: fly by hand (take off, forward / back / left / right, up / down, turn left / right, land) with a step of 20, 50 or 100 cm and 45° or 90°. Each press is one command through the same limits (and, on a Tello, the main-process guard).
- **Flights**: save a flight into the project (up to 10, with duration, distance, highest point and refused commands); **Replay** plays it back in the 3D view with play/pause, a timeline to drag, and 1×/2×/4×; **Make blocks** turns the commands that were carried out into a block program (refused ones are left out) that can be changed and flown again — on the simulator or a Tello (one undoable change). **Delete** / **Discard**.
- **Fix found on the way**: the simulator only advanced when the window redrew, at most 0.1 s per frame, so in a window that was not on top (few frames) a flight ran slowly. It now runs on the real clock in 50 ms steps, with a timer when frames stop; a replay plays on the same clock.
- Tests: 2 new unit tests (record the square, its summary, replay maths, its blocks fly the same square again; refused commands logged but not in the mission) and e2e `DRONE: a flight flown with the pilot pad is recorded, saved, replayed, and turned into blocks to fly again`. Screenshots: `docs/REA_SCREENSHOTS/P6_flights_and_pilot.png`, `P6_flight_replay.png`.
- Phase 6 is complete for the simulator. A real Tello has not been flown (6b, 6c).

## 2026-11-20: Phase 4, slices 4d–4f (colours, markers, QR, Playground, sounds, pose, gestures)

- **4d**: colour detection (nine named colours, where and how big), ArUco markers (our own detector for the original dictionary, numbers 0–1023, with a printable sheet) and QR codes (jsQR 1.4.0, Apache-2.0, added with approval). All run on the computer, on a small copy of the camera picture.
- **4e**: the AI Playground in Stage mode shows everything each tool finds, drawn over the live camera.
- **4f**: sound classes trained from the microphone (asked first, "Microphone on" indicator); body pose with PoseNet MobileNet 0.75 (bundled, 2.5 MB; MoveNet needs a Kaggle login, so PoseNet was chosen); gesture classes trained from the body points. Saved in the project.
- New AI Vision blocks for colours, markers, QR text, body points, gestures, sounds and loudness.
- Fixes on the way: the Stage bar's "Teach AI" and "Playground" buttons were squeezed into round icon buttons and their words overlapped; printed markers had faint seams between cells.
- Tests: 12 new unit tests; e2e `AI: the Playground finds a marker, a QR code and a colour…` with a test-drawn picture played as the fake camera (`TARIRO_FAKE_CAMERA_FILE`, development builds only). Screenshots: `P4_playground.png`, `P4_marker_sheet.png`.
- Not yet tried with a real webcam, a real person or a real microphone.

## 2026-11-20: Phase 5 finished (colour following, speed holding); 5d left out

- **Colour following** (Stage mode): "follow [colour] one step…" steers the Tariro towards a colour the camera sees, and stops when the colour is close, lost, or the camera stops answering. Its commands go through the safety layer. Example: "AI colour-following car".
- **Speed holding** (Upload mode): "hold both wheels at N RPM…" uses one PI controller per wheel with the encoders, with a power limit and anti-windup. Example: "Hold a steady speed".
- **5d AI assistant**: left out by Omorfo Tech Labs' decision until a provider and a prompt policy are chosen.
- Tests: 8 new unit tests (including the uploaded C++ controller compiled with g++ against simulated motors), the new example compiled with arduino-cli, e2e `AI: the colour-following car…`. Screenshots: `P5_colour_follow.png`, `P5_hold_speed_block.png`.
- Not yet run on a real robot.

## 2026-11-20: Phase 8 (circuit check, circuit diagram, debugger, guided diagnosis)

- **8a**: the code generator reports pin conflicts (two blocks setting one pin up differently; a block on the board's own motor-driver pins). A new circuit check compares the program's pins with the workbench wiring: LEDs in backwards or without a resistor, floating inputs, buttons that would short a pin, pins with nothing wired. New example "Find the wiring mistakes" (the Phase 8 exit check).
- **8b**: a circuit diagram of the same circuit in the Simulator tab, live, with backwards LEDs drawn backwards.
- **8c**: a block debugger: breakpoints from the block menu, pause, step, continue, variable and pin watches. On a real board, pausing stops the motors.
- **8d**: "Why isn't it working?" lists what the app found first, then what it cannot check.
- Tests: 26 new unit tests, 4 new end-to-end tests. Screenshots: `P8_circuit_check.png`, `P8_schematic.png`, `P8_schematic_mistakes.png`, `P8_debugger.png`, `P8_diagnosis.png`.
- Not yet tried on the real Tariro.

## 2026-11-20: Workbench: free wires, movable board and breadboard, any board

- Wires bend where you pull them, and their ends can be dragged to another hole or pin.
- The board (which also turns) and the breadboard can be moved anywhere on the bench; wires and parts follow.
- Any of the six boards can be chosen on the workbench; the Uno, Nano and Mega have their real header layouts.
- Tests: 5 unit tests, 1 end-to-end test. Screenshot: `BENCH_free_wires_board.png`.

## 2026-11-21: Workbench: breadboard sizes and turning, undo and redo

- Breadboard: half size (400 holes) or full size (830 holes); it turns as well as moves, with everything on it.
- Undo and redo for everything done on the workbench (buttons, Ctrl+Z, Ctrl+Y).
- Tests: 2 unit tests, 1 end-to-end test. Screenshot: `BENCH_full_breadboard.png`.
- Every component lies horizontal or vertical and turns all four ways (parts about their middle; the robot car faces and drives the way it is turned). Tests: 2 unit tests, 1 end-to-end test. Screenshot: `BENCH_orientation.png`.
- The board can no longer end up on top of the breadboard: a turn or resize that would cause it moves the board aside in the same step. Tests: 3 unit tests, 1 end-to-end test.

