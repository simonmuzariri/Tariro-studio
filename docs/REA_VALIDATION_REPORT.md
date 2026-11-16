# REA Validation Report

Status: **M5 validated; REA parity pass 1 complete (2026-11-15).**

## M5 — code mode, plotter, translation scaffolding
| Behaviour (PictoBlox evidence) | Tariro Studio result | Parity | Evidence |
|---|---|---|---|
| Switching to text coding warns that blocks and code do not work together (log #17) | "Edit as code…" asks first, then converts one way: blocks are removed, the C++ becomes editable in Monaco, and Verify/Upload compile the learner's text | ✔ | `M5_code_mode_plotter.png` (`ev_79adcffd…`), e2e "switching to code…" (checks the typed text reaches the compiled sketch) |
| Ace editor in Upload mode (09) | Monaco, read-only in blocks mode and editable in code mode, with compiler squiggles in both | ✔ | same |
| Serial Monitor only (09) | Serial Monitor plus a **Plotter** tab for plain or labelled numbers | ✔ (beyond PictoBlox) | same, e2e plotter test |
| ~70 UI languages (a11y evidence) | English only. Scaffolding is in place: a key catalogue, fallback to English, and a test that locales use known keys and placeholders. | partial (by design) | `renderer-logic.test.ts` |

Defect found by REA and fixed: after converting, the code header still said "Edit the blocks…". It now says the code was converted and is edited by hand; the e2e test asserts this.

### Parity pass 1 — summary against the feature matrix (P1 items)
- **Done and validated:** block editing (drag, snap, nest, undo, zoom, comments via Blockly), core categories, variables and functions, board selection with board-specific categories, live C++, compile and upload flow, port detection, Serial Monitor, extension library, projects (new, open, save, save as, unsaved prompt, autosave, recovery), examples, editable code mode.
- **Deferred by decision:** Stage mode and sprites (D1), accounts, AI/ML, Python environments, Junior blocks.
- **Open:**
  - Upload to a real board (no hardware connected yet).
  - Lists blocks and event hats ("when button pressed", "every N ms").
  - Block search and backpack (P2).
  - Installers that bundle arduino-cli with offline cores.
  - Translations beyond English. All 25 example-and-board compiles pass, AVR and ESP32-S3. The real-board upload check is still OPEN.

## M4 — kit extension packs and extension library
| Behaviour (PictoBlox evidence) | Tariro Studio result | Parity | Evidence |
|---|---|---|---|
| Extension library with category tabs and per-board limits (12) | "＋ Extensions" dialog: packs with kit tags, Add/Remove, incompatible packs disabled ("not for <board>"), packs in use locked. The choice is saved per project. | ✔ | `M4_extension_library.png` (`ev_80f6abc9…`), e2e "adding an extension…" and "Wi-Fi is only offered for the ESP32 board" |
| Board-dependent hardware categories (09) | Toolbox = board built-ins + the project's extensions + any pack the program already uses | ✔ | e2e "kit examples bring their extensions" |
| Bundled Arduino libraries (59, static) | Pinned libraries per pack and board family, installed on demand before compiling (offline message if that fails) | ✔ (different mechanism) | `services.test.ts` library tests |
| Display Modules "Cannot be used on Stage mode" (12) | No Stage mode in v1 (D1); every pack targets upload | n/a | — |

Kit coverage: each kit component has a block and appears in an example that is compiled for every listed AVR board (`npm run test:compile`):
- **Starter:** LED (blink), buzzer and button and traffic light and 7-segment (pedestrian crossing), potentiometer, LDR, soil, water level, rain, IR and sound (sensor report), DHT11 and I²C LCD (weather station).
- **Robotics:** motors, ultrasonic and servo (obstacle avoider), colour sensor and servo (colour sorter), MPU6050 (tilt alarm), HM10 (Bluetooth car).
- **IoT:** relay and pump, PIR, soil and OLED (smart garden), Wi-Fi (Wi-Fi hello, ESP32 only).

ESP32-S3: the weather station, smart garden and Wi-Fi hello examples compile for `esp32:esp32:esp32s3` with esp32 core 3.3.10. The first core install was cut off and left empty files in four support folders (`esp32s3-libs` bootloaders were 0 bytes, so esptool rejected them as invalid ELF images). Those folders were removed and reinstalled, and the compiles then passed. Still unverified on ESP32: the header-label → GPIO mapping and any real upload. The real-board upload check from M2 is still OPEN: no board has been connected to this machine yet.

## M3 — project files, examples, unsaved-changes guard, crash recovery
| Behaviour (PictoBlox evidence) | Tariro Studio result | Parity | Evidence |
|---|---|---|---|
| File menu: New, Open, Save, Save As (04) | Same, plus Export Arduino sketch, Recent, and examples grouped by kit. Keyboard shortcuts Ctrl+N/O/S/Shift+S. | ✔ | `M3_file_menu.png` (`ev_1cc6f4fe…`), e2e "save, keep editing…" |
| "Don't Forget to Save Your Project!" Yes / No / Cancel on New (log #10) | "Save your changes?" Save / Don't save / Cancel on New, Open, opening an example **and when closing the window** | ✔ (wider) | `M3_unsaved_prompt.png` (`ev_ac73598e…`, re-captured after the fix), e2e guard and close tests |
| `.sb3` project zip (sample) | `.tsp` zip (`project.json` + thumbnail), schema-validated, refuses files from newer versions, atomic writes, opens only paths the learner chose | ✔ (own format) | `project.test.ts`, `projects.test.ts` |
| Auto-backup (UNKNOWN in PictoBlox) | Autosave every 30 s and on blur, keeping 20 snapshots. After an unclean exit the next start offers "Recover your work?". | ✔ | e2e SIGKILL test. In a real dev session that had been killed, REA saw the recovery offer on the next start (live DOM `"Recover your work?"`). |

Defects found and fixed:
1. A fresh project showed as unsaved in the dev build. Fixed by telling load and edit changes apart and giving starter blocks stable ids.
2. The dialog backdrop did not cover the Monaco pane. Fixed by raising the z-index; `elementFromPoint` confirmed the backdrop is on top.
3. The suspected "dirty after New" turned out to be a hot-reload-corrupted dev session. An isolated production run is clean. A safeguard was added (a disposed workspace never reports changes), and the e2e test asserts it.

Capture note: REA screenshots of a backgrounded Electron window can be stale (identical hashes). The dev window is also visible on the user's screen, so manual use can change it between steps. Every finding above is backed by a live DOM query or an isolated Playwright run, not by a screenshot alone. The capture helper now brings the page to the front first.

## Boards — Malkon pinouts (2026-11-15)
- **Tariro = Malkon SMRS v0:** motor pins INA D4, ENA D5, INB D7, ENB D6 come from the user-supplied pinout. The generated sketch (`tariro-motors.tariro.ino`) uses direction + PWM-enable and compiles with arduino-cli.
- **Malkon One:** the blink and night-light examples compile.
- **Malkon ESP32-S3:** listed, but its compile is not verified (esp32 core not installed here). Its GPIO mapping is unconfirmed.

## M2 — compile, upload, ports, Serial Monitor
| Behaviour (PictoBlox evidence) | Tariro Studio result | Parity | Evidence |
|---|---|---|---|
| Serial (USB) port list, "No devices found", refresh (08) | Ports auto-refresh every 1.5 s, with no Refresh button needed. Non-USB UARTs are hidden. Boards are recognised by USB id (CH340 → Tariro). A single connected board is auto-selected. A "switch board" chip appears on mismatch. | ✔ (improved) | `M2_upload_done_mock.png` (`ev_65fba05f…`), unit tests |
| Upload Code button + Log (09) | Verify and Upload buttons, a live progress bar during upload (parsed from avrdude/esptool), streamed Output tab, and a plain-language result | ✔ | same, e2e "uploads, and logs progress" |
| Compile via arduino-builder; upload via avrdude/esptool (static) | arduino-cli 1.3.1 `compile` / `upload --input-dir`, one job at a time, cancellable (kills the process group or the Windows process tree) | ✔ (modern toolchain) | `services.test.ts` (13 tests) |
| Serial Monitor (09) | Baud selector, connect/disconnect, send with line-ending choice, auto-scroll, clear. The monitor port is released for an upload and reopened afterwards. | ✔ | `M2_serial_monitor_mock.png` (`ev_ff0bc162…`), e2e echo test |
| Error reporting (PictoBlox: log text only) | gcc diagnostics parsed for `sketch.ino`, listed under Problems as "compiler · line N", shown as squiggles in the code, and attached to the block that produced the line via the source map | ✔ (beyond PictoBlox) | e2e "compiler errors … mapped back to a block" |
| Friendly failures | Permission denied → the `dialout` fix. "not in sync" → check board and port. Busy port, missing library, sketch too big. | ✔ | `toolchain.test.ts` |

Test doubles: `TARIRO_SERIAL_MOCK=1` gives a virtual Tariro on `/dev/ttyMOCK0` (serialport's mock binding, echo on). `test/fixtures/fake-arduino-cli.mjs` stands in for arduino-cli. Both work only in unpackaged builds.

Real toolchain: Verify against the real arduino-cli passes in the e2e suite, and the 8 golden sketches compile.

Packaging: a packaged Linux build unpacks `@serialport/bindings-cpp` native binaries from the asar and ran 10 s without startup errors.

Defects found by REA during M2, both fixed:
1. The Serial Monitor row overflowed: the Send button was clipped and the status truncated. Fixed with grid `minmax(0,1fr)` and toolbar wrapping, and verified the Send button now sits inside the viewport.
2. The Output "Clear" button overlapped log text. Fixed with right padding.

Capture artefact: native `<select>` popups sometimes appear open in REA screenshots of a backgrounded Electron window. The DOM state was correct in every case.

**Open: exit criterion "upload to a real Tariro or Uno works".** This needs a board connected over USB. Run `npm run dev`, choose the port, then Upload. Expect "Uploaded!" and the LED to blink with the blink example.

## Earlier milestones

## M1 — block workspace and live Arduino C++
Method: the same Arduino program that was built in PictoBlox (interaction log #21, screenshot `10_arduino_program_codegen.png`) was loaded into Tariro Studio's dev build and captured with REA. Drag-and-drop itself is covered by the Playwright test "dragging a pin block into forever updates the code".

| Behaviour (PictoBlox evidence) | Tariro Studio result | Parity | Evidence |
|---|---|---|---|
| Board hat is the program root (10) | `when board starts up` is the root, and loose blocks are greyed out and excluded | ✔ | `M1_tariro_studio_motor_program.png` (`ev_49b2e8ef…`) |
| Blocks before `forever` → `setup()`, body → `loop()` (10) | Same rule | ✔ | `M1_tariro_studio_arduino_program.png` (`ev_52c0c529…`) |
| `pinMode` hoisted to the top of `setup()` (10) | Hoisted **and deduplicated** | ✔ (improved) | same |
| Globals/macros section when needed (codegen sample) | Sections for includes, globals (variables, prototypes, pin constants) and functions | ✔ | golden snapshots |
| `digitalWrite(13, true)`, `delay(1 * 1000)` | `digitalWrite(13, HIGH)`, `delay(1000)` (constant-folded) | ✔ (clearer for learners) | same |
| Live code update on every drop (09/10) | Updates about 120 ms after each change; selecting a block highlights its C++ lines | ✔ | e2e + source-map unit test |
| Board selection adds board categories (09) | Tariro adds a "Tariro" category; Uno/Nano/Mega omit it | ✔ | e2e "switching board…" |
| Incompatible blocks greyed in Upload mode (09) | Blocks not available on the board are excluded, with a warning on the block | ✔ (different UX) | unit test |
| Ace read-only C++ pane (09) | Monaco read-only pane with warnings list; clicking a warning focuses its block | ✔ | screenshots |

Defects found by REA during validation, all fixed and re-captured:
1. Toolbox category labels were nearly invisible in OS dark mode (computed `rgb(231,234,240)` on white). Now fixed dark text, verified at `rgb(29,35,48)`.
2. The warnings footer was clipped (17 px high). It now has a 34 px minimum height.
3. The placeholder-pin warning repeated once per motor block. Board-level warnings are now reported once (`scope: 'program'`).
4. Blockly fetched `sprites.svg` from static.blockly.com, which the CSP blocked and which would fail offline. Blockly's media is now bundled and served locally, and sounds work offline.
5. The first REA screenshot showed a stale frame from the backgrounded window. A live DOM query confirmed the correct state, and the screenshot was retaken.

Exit criteria: golden tests pass (8 snapshots), and the blink and motor sketches **compile with arduino-cli 1.3.1 / arduino:avr 1.8.7** for Tariro, Uno, Nano and Mega (8/8).

## Earlier milestones

## M0 — shell, IPC and security baseline
| Check | Method | Result | Evidence |
|---|---|---|---|
| App window opens with title "Tariro Studio" | REA `inspect_web_page` (dev build, CDP :9444) | PASS | `ev_a8de0893…` (a11y root "Tariro Studio") |
| `app.info` IPC round-trip renders version 0.1.0, Electron 44.10.1, Node 24.22.1 | REA a11y text + screenshot | PASS | `ev_a8de0893…`, `REA_SCREENSHOTS/M0_tariro_studio_shell.png` (`ev_9f9f8e19…`) |
| No renderer console errors, no network requests | REA `inspect_web_page` console/network capture | PASS (only Vite and React dev notices) | `ev_a8de0893…` |
| Packaged binary has hardened fuses (PictoBlox: RunAsNode **on**, ASAR integrity **off**, OnlyLoadAppFromAsar **off**) | REA `inspect_electron_fuses` on `linux-unpacked/tariro-studio` | PASS: RunAsNode off, NodeOptions off, CLI inspect off, cookie encryption on, ASAR integrity on, OnlyLoadAppFromAsar on, file-protocol extra privileges off | `ev_0748dfad…` |
| Packaged `app.asar` contains only `out/` and `package.json` (no node_modules) | `asar list` | PASS | — |
| Production build served from `app://studio/index.html`; `require`/`process` absent in renderer | Playwright e2e | PASS | `packages/app/e2e/shell.spec.ts` |

**REA limitation found:** `capture_web_screenshot` and `inspect_web_page` accept only HTTP(S) pages, and `inspect_electron_page` accepts only `file://`. Our production `app://` protocol is therefore not inspectable by REA page tools. **Mitigation:** REA page validation runs against the dev build (`TARIRO_STUDIO_REMOTE_DEBUG_PORT=9444 npm run dev`, renderer served by Vite over http). Production-only properties (fuses, asar contents, `app://` origin) are covered by REA `inspect_electron_fuses` and by Playwright. REA's own limitation also applies: the ASAR-integrity fuse is enforced only on macOS and Windows.

Method per feature: REA inspection of the PictoBlox workflow → independent implementation → run our IDE under CDP → REA screenshots/page inspection of our IDE → side-by-side comparison → defects → re-test.

## Planned REA checkpoints (from IDE_DESIGN.md §13)
| Milestone | REA checks on our IDE | Compared against |
|---|---|---|
| M1 | `capture_web_screenshot` + `inspect_web_page` of workspace after the same drag sequence as PictoBlox log #13–16, 21–22; diff generated C++ structure | 06, 10, codegen sample |
| M2 | Screenshots of the upload flow (compile → upload → done/error); runtime log | 09 + PictoBlox upload pass (pending hardware) |
| M3 | Save/open round-trip, unsaved prompt | log #10 |
| M4 | Board selector + extension library | 07, 12 |
| M5 | `inspect_electron_fuses` on our packaged binary (expect hardened); full parity sweep | `ev_33815109` |

## Feature parity matrix
| Feature | PictoBlox evidence | Our IDE evidence | Parity | Notes |
|---|---|---|---|---|
| Block drag/snap/insert/nest | 06 | — | — | |
| Live Arduino C++ codegen (setup/loop, hoisting) | 10 | — | — | |
| Board selection → categories | 07, 09 | — | — | |
| Serial port connect dialog | 08 | — | — | |
| Upload mode disables stage-only blocks | 09 | — | — | |
| Undo/redo, duplicate, context menus | log #26–28 | — | — | |
| Project save/open | U | — | — | |
| Extension library | 12 | — | — | |
