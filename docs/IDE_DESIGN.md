# IDE Design — Tariro Studio

Phase 3 design for an independent visual-programming IDE for educational robotics, electronics and IoT, inspired by the capabilities observed in PictoBlox (see `REA_REPORT.md`). No PictoBlox code, assets or proprietary formats are reused. Every component below is written from scratch on open-source foundations.

Status: **v0.2 — 2026-11-15. Decisions confirmed by the product owner (see §0).** Items marked **NEEDS INPUT** use a stated default until confirmed.

## 0. Confirmed decisions (2026-11-15)

| # | Decision | Effect |
|---|---|---|
| D1 | v1 is **upload-first**. Live mode (Firmata) comes in v2. No sprite stage. | §1 scope as written |
| D2 | v1 uses **file snapshots, not SQLite**, for autosave and versions | Default accepted (not objected to) |
| D3 | The Tariro robotics board is the **Malkon SMRS v0** (ATmega328P + CH340, `arduino:avr:uno`, 115200). Its TB6612FNG pins are **confirmed** from the published pinout (2026-11-15): INA D4, ENA D5, INB D7, ENB D6 | Motor blocks generate direction + PWM-enable code. The IR, buzzer and RGB jumper pins are still unknown |
| D4 | **Windows and Linux are equal priority** from the first release | CI builds and tests on both; installers are NSIS (Windows), `.deb` and AppImage (Linux); macOS is best-effort |
| D5 | The product name is **Tariro Studio** (Omorfo Tech Labs) | Used for app ID, window title and file association `.tsp` |

---

## 1. Goals and scope

### Primary users
Learners aged about 8–18 and their teachers, using the Tariro Starter, Robotics and IoT kits, often in schools with **limited or no internet**.

### Inputs taken into account
- **Tariro board** (from `BOM_tariro_2026-01-20.csv`): ATmega328P @ 16 MHz, CH340C USB-serial, TB6612FNG dual motor driver, AMS1117-5.0, 2 DIP switches, 1 button, RX/TX/SCK/PWR LEDs. This is Uno-class, so the target is `arduino:avr:uno`.
- **Kits** (from the kit-contents images):
  - Starter: LEDs, buzzer, LDR, rain, soil moisture, IR, sound, water level, 7-segment, I2C LCD, traffic light, potentiometer, DHT11, push buttons.
  - Robotics: ultrasonic, colour sensor, 4× servo, 2× DC geared motors, MPU6050, HM10 BLE, Tariro shield, 3D arm.
  - IoT: **Malkon ESP32**, 4-channel relay, PIR, soil moisture, water level, pump, DHT11, 0.96" OLED, buzzer, buttons.

### v1 must do (P1)
1. Block workspace with Scratch-like blocks: drag, snap, nest, undo/redo, zoom, comments, duplicate, clean-up.
2. Core categories: Events (board start), Control, Operators, Variables, Lists, Functions (My Blocks), Math, Text, Serial.
3. Board selection (**Tariro**, Arduino Uno/Nano/Mega, ESP32), which reconfigures the toolbox and generator.
4. **Live C++ generation** shown beside the workspace, read-only, with highlighting.
5. Compile and upload through a bundled `arduino-cli`, with a progress log and errors mapped back to blocks where possible.
6. Serial port detection, connect and upload. Includes a **Serial Monitor** with send box, baud selector and a simple plotter.
7. Extensions as data packs, with first-party packs for every Tariro kit component.
8. Projects: New / Open / Save / Save As / Recent, autosave plus crash recovery, unsaved-changes prompt, example projects per kit.
9. **Text mode:** Monaco C++ editor. You can convert a block project to code one way, as PictoBlox does, with a warning.
10. Offline-first: AVR and ESP32 cores and all kit libraries are bundled, so nothing is downloaded at runtime.

### v2 (P2)
- **Live mode** (blocks run on the PC and drive the board in real time) using **Firmata**.
- MicroPython generator for ESP32.
- BLE (HM10) connection.
- Library manager UI.
- Block search.
- Backpack.
- PNG export of scripts.
- Localisation (English first, then Shona and Ndebele).
- Teacher project templates.

### v3 / out of scope for now (P3)
- Sprite stage and animation.
- Python and notebook environments.
- AI/ML extensions.
- Junior (icon) blocks.
- Paint, video and 3D tools.
- `.sb3` import.
- Accounts and cloud sharing.

**D1 (confirmed):** v1 targets **Upload mode only**. Live mode comes in v2, and a sprite stage is not planned.

---

## 2. Technology stack

| Concern | Choice | Why (vs prompt suggestions) |
|---|---|---|
| Shell | **Electron** (current stable at implementation time), sandboxed renderer, `contextIsolation`, hardened fuses | Cross-platform desktop; we avoid PictoBlox's open localhost port and permissive fuses (REA F12) |
| UI | **React 19 + TypeScript 6 + Vite 8** (`electron-vite` 6) | Prompt stack (React 19 is current; pinned versions in `tariro-studio/package.json`) |
| State | **Zustand** stores per domain (project, board, connection, build) | Simpler than Redux for this size |
| Blocks | **Google Blockly** (Apache-2.0) with the `zelos` renderer and a custom theme | Maintained upstream. Scratch-like look without forking scratch-blocks |
| Code editor | **Monaco** | Prompt stack. Better than Ace (what PictoBlox uses) for autocomplete and diagnostics |
| Toolchain | **arduino-cli** (bundled binary, private data dir) | Replaces the deprecated `arduino-builder`. Handles compile, upload, board list, cores and libraries in one tool |
| PlatformIO | **Not used in v1** | arduino-cli covers AVR and ESP32. PlatformIO adds about 500 MB and a Python dependency |
| Serial | **serialport** (main process only) | Industry standard. Same choice PictoBlox made |
| Live mode | **Firmata** (StandardFirmata / ConfigurableFirmata) | Open protocol. Avoids writing our own firmware |
| Settings | **electron-store** (JSON) | Small and simple |
| Project history | Snapshot files in the user data folder. **SQLite (`better-sqlite3`) only if needed later** | **D2:** SQLite adds native-module rebuild costs. File snapshots cover autosave and versioning in v1 |
| Tests | **Vitest** (core, generators), **Playwright `_electron`** (UI), arduino-cli compile of golden sketches, **REA** for parity | — |
| Packaging | electron-builder: NSIS (Windows) + `.deb`/AppImage (Linux) as equal-priority targets (D4); dmg best-effort | CI matrix runs on Windows and Ubuntu. Windows needs CH340 driver guidance, Linux needs `dialout` guidance |

---

## 3. Process architecture

```
┌──────────────────────────── Main process (Node) ────────────────────────────┐
│ AppService      window lifecycle, menus, single-instance, file associations │
│ ProjectService  open/save zip, autosave snapshots, recent list, recovery    │
│ ToolchainService  arduino-cli wrapper (compile, upload, board list,         │
│                   core/lib install from bundled offline index)              │
│ SerialService   port watch (hot-plug), connect, read/write stream, baud     │
│ LiveService (v2) Firmata session over SerialService                         │
│ SettingsService electron-store                                              │
└──────────────▲───────────────────────────────────────────────────────────────┘
               │ typed IPC: invoke (request/response) + event streams
┌──────────────┴──── Preload: exposes window.studio: StudioApi (only) ─────────┐
└──────────────▲───────────────────────────────────────────────────────────────┘
┌──────────────┴──────────── Renderer (React, sandboxed) ─────────────────────┐
│ Shell (menu bar, mode/board/port pickers) │ BlockWorkspace (Blockly)        │
│ CodePane (Monaco, read-only or editable)  │ BottomDock (Log, Serial, Plot)  │
│ ExtensionLibrary modal │ ExampleBrowser │ Dialogs                           │
│ uses @studio/core (pure TS): registries, codegen, project model             │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules:
- **Code generation runs in the renderer** (pure TypeScript, fast, testable). Only the C++ *text* crosses into the main process. This matches the observed PictoBlox split while keeping our own implementation.
- No HTTP server. The renderer loads via the `app://` custom protocol.
- The IPC surface is **one typed interface** (`StudioApi`), about 25 methods and 6 event streams, instead of 344 ad-hoc channels.

---

## 4. Repository layout (npm workspaces monorepo)

```
tariro-studio/
├─ packages/
│  ├─ core/            # pure TS, no DOM/Node: types, registries, project model, codegen engine
│  ├─ blocks/          # Blockly block JSON, field types, toolbox builder, theme, renderer cfg
│  ├─ gen-arduino/     # Arduino C++ generator (sectioned), per-block emitters
│  ├─ gen-micropython/ # (v2)
│  ├─ extensions/      # first-party packs: tariro-board, starter, robotics, iot, displays …
│  ├─ hardware/        # main-process services: toolchain, serial, firmata (v2)
│  └─ app/             # electron main + preload + React renderer
├─ resources/
│  ├─ arduino-cli/<os>/            # pinned binary
│  ├─ arduino-data/                # pre-installed cores (avr, esp32) + libraries, offline
│  └─ examples/                    # our own example projects
├─ tests/ (golden/, e2e/, rea/)
└─ docs/
```

`core` depends on nothing UI-specific, so the generators can be unit-tested and compiled in CI without Electron.

---

## 5. Board model

A board is **data**, so Tariro variants and future boards are added without code changes.

```ts
// sketch — full definitions in design/core-types.ts
interface BoardDefinition {
  id: 'tariro' | 'arduino-uno' | 'arduino-nano' | 'arduino-mega' | 'esp32-devkit' | string;
  name: string; fqbn: string;                    // tariro → 'arduino:avr:uno' (NEEDS INPUT: bootloader)
  family: 'avr' | 'esp32';
  usb: { vid: string; pid: string; label?: string }[];   // CH340: 1a86:7523 for auto-detect
  pins: PinMap;                                   // digital/analog/pwm/i2c/spi/serial + onboard
  onboard?: OnboardPeripheral[];                  // Tariro: TB6612FNG motors, button, DIP switches, LEDs
  generators: Language[];                         // ['arduino'] (+ 'micropython' for esp32 in v2)
  defaultExtensions: string[];                    // e.g. tariro: ['tariro-board','starter']
  upload: { speed?: number; protocol?: string };
}
```

**Tariro board (D3, confirmed 2026-11-15):** the Malkon SMRS v0. `fqbn: 'arduino:avr:uno'`, upload speed 115200, USB `1a86:7523` (CH340). The TB6612FNG is wired as one direction pin plus one PWM enable per motor: INA D4, ENA D5 (motor A) and INB D7, ENB D6 (motor B). The board inverts the second input itself. D2, D3, D12 and D13 are on the top headers.

**Other boards in the list:**
- **Malkon One:** ATmega328P with CH340, Uno-compatible. It has IR, buzzer and RGB LED jumpers, plus ESP-01 and nRF24L01 sockets.
- **Malkon ESP32:** ESP32-S3-WROOM-1 (`esp32:esp32:esp32s3`), Uno form factor.

**Still unknown:**
- The Arduino pin numbers behind the IR / BUZ / RGB jumpers on the SMRS and the One.
- The ESP32-S3's header-label → GPIO mapping. Pins are offered as GPIO numbers, and the board shows a "pins unconfirmed" note.

**NEEDS INPUT (defaults in use):**
- Malkon ESP32 module: defaulting to a generic ESP32 DevKit (`esp32:esp32:esp32`).
- Robotics-kit colour sensor: defaulting to the TCS3200 frequency-output module (the most common hobby part). TCS34725 (I2C) would be a separate block set.

---

## 6. Extension architecture

An extension is a manifest plus block definitions plus generator emitters. Extensions load from `packages/extensions/*` at build time, and from a user folder for third-party packs in v2.

```ts
interface ExtensionManifest {
  id: string; name: string; version: string;
  category: 'core' | 'sensors' | 'actuators' | 'displays' | 'robotics' | 'iot' | 'communication';
  colour: string; icon: string;
  boards: string[] | '*';                       // compatibility filter (UI greys out incompatible)
  libraries?: { name: string; version: string }[]; // pinned arduino libs (bundled offline)
  blocks: BlockSpec[];                           // Blockly JSON + our metadata
  toolbox: ToolboxCategorySpec;
  emitters: Record<string /*block type*/, ArduinoEmitter>;
}
```

The first-party packs map directly to the kits:
- **tariro-board:** motors (TB6612), onboard button, DIP switches, LEDs.
- **starter:** LED, buzzer/tone, LDR, rain, soil, IR, sound, water level, potentiometer, traffic light, 7-segment, DHT11.
- **robotics:** ultrasonic, servo, DC motor, colour sensor (TCS3200/TCS34725, NEEDS INPUT), MPU6050, robot-arm helpers.
- **displays:** I2C LCD 16x2, SSD1306 OLED.
- **iot:** relay, PIR, pump, ESP32 WiFi, HTTP/MQTT, web dashboard (v2).
- **communication:** HM10 BLE serial.

---

## 7. Code generation engine

### 7.1 Sectioned output
Every emitter writes into named sections, never into one flat string:

```
includes   → #include lines           (deduplicated by key)
globals    → objects, variables, consts (deduplicated by key)
functions  → helper functions / My Blocks (deduplicated by key)
setup.init → pinMode, begin(), attach() (deduplicated, ordered by priority)
setup.body → user statements before the main loop block
loop.body  → user statements inside "forever"
```

The output is assembled with a fixed header comment (our own wording), then includes, globals, functions, `setup()` and `loop()`. This reproduces the *observed behaviour* (pinMode hoisting, setup/loop split, global section) through our own design. Deduplication means ten "set LED pin 13" blocks still produce one `pinMode(13, OUTPUT)`.

### 7.2 Program structure rules
- **Root:** exactly one `when board starts` hat per program. Additional hats are disabled, with a warning badge.
- Statements under the hat go into `setup.body`. The **`forever` block**, when it is the last top-level statement, becomes `loop()`. A `forever` anywhere else is emitted as `while (true) {}`.
- Unattached stacks are greyed out and excluded, the same visual cue PictoBlox uses.
- **Event hats (v1):**
  - "when button pressed" and "every N ms" compile to **non-blocking polling** in `loop()` using `millis()`.
  - A hat combined with a `forever` loop is flagged so teachers understand the timing.
- Variables have types `number` (`double`, or `long` when every operand is an integer, v2 optimisation), `bool` and `String`. Lists map to fixed-capacity arrays (default 32, configurable per list).
- **My Blocks** become C++ functions with typed parameters, and are emitted into `functions` with forward declarations.

### 7.3 Traceability
Each emitted statement records its source block ID, which gives a `sourceMap: line → blockId`. Compiler errors from arduino-cli are parsed (`file:line:col: error:`) and highlighted on the offending block and on the code line.

### 7.4 Quality gate
**Golden tests:** each example project's generated sketch is snapshot-tested and also compiled with `arduino-cli compile` for every compatible board in CI.

---

## 8. Hardware services (main process)

| Operation | Implementation |
|---|---|
| Detect boards | `arduino-cli board list --format json` plus `serialport` hot-plug polling (1 s). Matches VID:PID to `BoardDefinition.usb` and suggests the board |
| Compile | Write the sketch to `<userData>/build/<projectId>/sketch/sketch.ino`. Run `arduino-cli compile --fqbn <fqbn> --build-path … --format json --config-file <bundled>`. Stream stdout/stderr to the Log. Parse size info |
| Upload | `arduino-cli upload -p <port> --fqbn <fqbn> --input-dir <build>`. Release the Serial Monitor port first and reopen it afterwards |
| Cancel | Kill the process tree (`tree-kill`) |
| Serial Monitor | `serialport` with a line parser. Baud selection, send box, newline mode, timestamping, and a plotter for numeric CSV lines |
| Offline cores and libs | arduino-cli `directories.data/user` point into `resources/arduino-data` (read-only), copied to userData on first run for updates |
| Linux permissions | Detect `EACCES` on `/dev/ttyUSB*` and show a guided fix (`dialout` group). No automatic sudo |
| Windows | Detect a missing CH340 driver (port absent while the USB device is present) and show a help link |

Event streams to the renderer: `build:progress`, `build:log`, `upload:state`, `ports:changed`, `serial:data`, `serial:state`.

---

## 9. Project model and file format

The extension is `.tsp` (Tariro Studio Project). It is a zip containing:

```
project.json   { format: "tariro-studio", formatVersion: 1, appVersion, id, name,
                 board: "tariro", extensions: ["tariro-board","starter"],
                 mode: "blocks" | "code",
                 workspace: <Blockly serialization JSON>,   // when mode=blocks
                 code?: string,                             // when mode=code (or user override)
                 serial: { baud: 9600 }, createdAt, modifiedAt }
thumbnail.png  workspace snapshot
```

- **Autosave:** every 30 s and on blur, saved to `<userData>/autosave/<id>/<timestamp>.tsp`, keeping the last 20. On a crash the app offers recovery at the next launch.
- **Versioning:** a "Save version…" action creates a named snapshot, and you can browse and restore them.
- **Migrations:** `formatVersion` drives a list of upgrade functions in `core/project/migrations.ts`.
- **Export:** `.ino` (sketch), `.png` (workspace), `.tsp`.

---

## 10. UI layout

```
┌ Menu: File Edit Board Connect Examples Help │ [Project name] ● │ Board ▾ │ Port ▾ │ ▶ Upload ┐
├────────┬───────────────────────────────────┬─────────────────────────────────────────────┤
│Category│                                   │  Code (Monaco, read-only in Blocks mode)    │
│ rail   │        Blockly workspace          │                                             │
│+ Ext.  │   (zoom, trash, undo/redo)        ├─────────────────────────────────────────────┤
│        │                                   │  Log │ Serial Monitor │ Plotter             │
└────────┴───────────────────────────────────┴─────────────────────────────────────────────┘
```

- **Upload button states:** Compile → Upload → Done or Error, with a progress bar. A separate Verify (compile only) button sits next to it.
- **Mode switch:** Blocks or Code. Converting to code is one-way and confirmed with a warning.
- **Accessibility:** keyboard navigation (Blockly keyboard-nav plugin), high-contrast theme, adjustable block scale.

---

## 11. Security and quality baseline

- Fuses: RunAsNode off, NodeOptions off, CLI inspect off in production, ASAR integrity on, OnlyLoadAppFromAsar on.
- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict CSP, no remote content.
- IPC handlers validate arguments with zod schemas from `core`.
- No analytics by default.

---

## 12. Testing and REA validation

| Level | Tooling | What |
|---|---|---|
| Unit | Vitest | registries, project load/save/migrate, every block emitter |
| Golden | Vitest + arduino-cli | examples → expected `.ino`, and actual compile per board |
| Integration | Vitest (Node) | ToolchainService against the bundled arduino-cli. SerialService with a virtual port (`socat` pty) |
| E2E | Playwright `_electron` | drag/snap, board switch, upload flow against a mocked toolchain |
| Hardware-in-loop | manual checklist, later scripted | Tariro / Uno / ESP32 upload plus serial echo sketch |
| Parity | **REA** | Each milestone: REA screenshots and inspection of both apps, filling in `REA_VALIDATION_REPORT.md` |

---

## 13. Milestones

| # | Deliverable | Exit criteria |
|---|---|---|
| M0 | Monorepo, Electron shell, typed IPC skeleton, CI (lint, test, build) | App opens; `studio.app.version()` round-trips |
| M1 | Blockly workspace, core categories, Tariro and Uno boards, sectioned Arduino generator, live code pane | Golden tests pass; generated blink and motor sketches compile |
| M2 | arduino-cli compile/upload, port detection, Log, Serial Monitor | Upload to a real Tariro or Uno works; errors map to blocks |
| M3 | Project save/open/autosave/recovery, examples, unsaved-changes prompt | Round-trip tests; crash-recovery test |
| M4 | Extension packs for all three kits, extension library UI, ESP32 board | Every kit component has blocks, an example and a compile test |
| M5 | Code mode (Monaco, editable), Verify, plotter, i18n scaffolding | REA parity pass 1 complete |
| M6 (v2) | Firmata live mode, MicroPython for ESP32, BLE | — |

---

## 14. Open questions

Resolved on 2026-11-15: D1–D5 in §0.

Still open (defaults in use, not blocking M0):
1. Pin numbers of the IR receiver, buzzer and RGB LED jumpers (SMRS and One). The SMRS motor pins were confirmed on 2026-11-15.
2. Malkon ESP32-S3 header-label → GPIO mapping, and the colour sensor model. Needed by M4.
3. Brand assets (logo, colours) from Omorfo Tech Labs. A neutral theme is used until then.
