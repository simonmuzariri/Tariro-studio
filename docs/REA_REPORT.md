# REA Reconnaissance Report — PictoBlox 9.0.0 (Linux .deb)

Date: 2026-11-15 · Investigator: Claude Code using REA 6.9.0 (`rea-agents`, MCP, 255 tools)
Status: **Initial reconnaissance complete (Phase 1–2).** IDE implementation has not started.

Classification used throughout: **VERIFIED** (directly observed via REA, or via a live interaction whose result REA captured), **INFERRED** (strongly suggested by observation or static text), **UNKNOWN** (not established yet).

## 1. REA initialisation

| Step | Result |
|---|---|
| REA located | MCP server `rea` v6.9.0, package root `~/.npm/_npx/af752b90495482d7/node_modules/rea-agents`. Skill `reverse-engineer-anything` loaded. |
| Capabilities checked | `binary_session` returned the tool inventory. JavaScript/Electron/web/runtime tools are **available**. Native decompilers (Ghidra, IDA, Hopper, Kuna), JADX, Binwalk, TShark, WABT and Wakaru are **not configured**. None of these are needed for an Electron app. |
| Reference target | `~/Downloads/PictoBlox-Setup-9.0.0.deb`, already extracted to `~/rea-work/pictoblox-9.0.0/root` (earlier REA CLI run, same day). The app is **not installed system-wide**; it was run from the extracted tree with an isolated profile (`runtime-profile/`). |
| Live access verified | App launched with `--remote-debugging-port=9333 --inspect=9334`. REA `capture_web_screenshot`, `inspect_web_page`, `list_javascript_runtime_targets` and `inspect_electron_fuses` all succeeded against it. |
| Workspace | This folder: reports, `REA_SCREENSHOTS/`, `evidence/` (raw REA Evidence JSON, exported bundle) and `rea-tools/` (helper scripts). |

### REA limitations met (documented as required)

1. **`capture_browser_scenario` (connect mode) refuses this target** with `target_not_allowed`. Its service-worker guard reports `policy_unprotected` inside Electron's renderer, which is a REA/Electron incompatibility. `capture_electron_scenario` only supports click/wait by CSS selector and returns no screenshots. Neither tool has a **drag** action, and block programming needs drag.
   → **Mitigation:** UI *actions* (click, drag, key, read editor value) were sent with a small CDP input driver, `rea-tools/cdp.mjs`. Every resulting *state* was captured with REA (`capture_web_screenshot`, `inspect_web_page`). Action results reported from the driver (for example generated C++ text and block positions) are marked as such.
2. **`analyze_javascript_application` on `main-bundle.js` timed out** at the MCP host deadline. An earlier REA CLI run of the same analysis (evidence `ev_1a4ae8bd…`, `evidence/main-summary.json`) completed, but recovered **zero Electron IPC/BrowserWindow facts**. The main process is a single webpack bundle that defeats REA's static Electron boundary extraction. REA's `trace_application_feature` for `avrdude` failed with an out-of-memory error on the 150 MB bundle.
   → **Mitigation:** targeted *static text* inspection (grep) of the extracted `main-bundle.js` for toolchain arguments and IPC channel names. These results are marked **INFERRED (static text)**.
3. `inspect_desktop_application` timed out on the 300 MB install tree and was not retried.

## 2. Executive summary of findings

PictoBlox 9.0.0 is an **Electron app (main process Node 16.5.0) wrapping a heavily extended fork of the Scratch 3 GUI** (`scratch-gui` + `scratch-vm` + `scratch-blocks` + `scratch-paint`). The renderer is **served over HTTP from an embedded Express server on `localhost:21679`**, not loaded from `file://`, and a socket server listens on `21677`. Hardware programming works by **block → C++ text generation in the renderer**, then **`arduino-builder` (Arduino 1.8.5, bundled) compile** and **`avrdude`/`esptool` upload** spawned from the main process. A separate **Stage mode** runs blocks live in the Scratch VM and talks to the board over serial/BLE using PictoBlox firmware.

Key VERIFIED facts:

- Launcher offers 9 environments: Junior Blocks, Blocks, Py Editor, Py Notebook, ML Environment, 3D & XR Studio, Paint, Screen Recorder, Video Editor (`01_startup.png`, accessibility evidence `ev_a79f6fd8…`).
- Blocks editor has 9 core categories: Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables, My Blocks. Selecting a board adds categories, for example Arduino Uno, Actuators, Sensors, Display Modules and Dabble (`05`, `09`).
- 16 boards are listed: evive, Quarky, Wizbot, Arduino Uno/Mega/Nano, ESP32, T-Watch, Boffin, micro:bit, AR/VR Controller, TECbits, LEGO EV3/BOOST/WeDo 2.0, Go DFA (`07_board_selector.png`).
- **Mode toggle Stage ↔ Upload.** In Upload mode, Stage-only blocks turn grey (disabled), the Python tab becomes **C++**, and a live **Ace** editor shows generated C++ with an **Upload Code** button, a **Log** and a **Serial Monitor** (`09`, `10`).
- **Codegen rules observed live:** a board hat block (`when Arduino Uno starts up`) is the program root. Blocks before `forever` go into `setup()` and the `forever` body goes into `loop()`. `pinMode()` calls are **hoisted** to the top of `setup()`, and timer blocks add a global `//MACROS` section (`evidence/codegen_arduino_uno_sample.cpp`).
- Project file = Scratch 3 **`.sb3` zip** with extra top-level keys `boardSelected` and `pictobloxVersion`, plus a `ProjectSnap.png` thumbnail. Hardware opcodes are namespaced by extension ID (`arduinoUno_arduinoUnoStartUp`, `actuators_initialiseMotor`).
- Extension library: about 35 extensions in categories AI & ML, Hardware, Robots, IoT, Games & Animation (`12_extension_library.png`).

## 3. Per-feature findings

Format: procedure → actions → observed → evidence → interpretation → implementation requirement → test requirement.

### F1 Application startup — VERIFIED
- **Procedure:** launched the extracted binary with debug ports, REA `capture_web_screenshot` + `inspect_web_page`.
- **Observed:** splash, then launcher "What would you like to do?" over a fully mounted (hidden) GUI. The log shows `PORT SET {pictoBloxPort 21679, pictoBloxSocketServerPort 21677}`, an auto-update check, Python runtime paths (`ppy-basic`, `ppy-advance`, `ppy-ml`), and a TensorFlow backend flag. The page target URL is `http://localhost:21679/`.
- **Evidence:** `01_startup.png` (`ev_e89d4525…`), `ev_a79f6fd8…` (DOM 2644 nodes, 9 scripts), `~/rea-work/pictoblox-9.0.0/runtime3.log`.
- **Interpretation:** the GUI is one SPA. The environment chooser is a modal that sets the coding environment; IPC `SET_CODING_ENV` is INFERRED from static text.
- **Requirement:** a launcher/environment chooser routing into one shell app. Serve the UI from a local server or via `file://` (design choice).
- **Test:** cold start shows the chooser in under 6 s, and each tile opens the right environment.

### F2 Block editor workspace — VERIFIED
- **Actions:** opened Blocks, dragged `when flag clicked`, `forever`, `move`, `turn` from the flyout.
- **Observed:** snapping to the previous block, insertion of a block between hat and `forever` (it spliced in), nesting inside the C-block mouth, and a stray block left unconnected when dropped away from a connection. Zoom +/−/reset, undo/redo arrows, Backpack bar, and sprite/stage panes are present.
- **Evidence:** `05_blocks_editor.png`, `06_program_built.png` (`ev_8bcf41db…`).
- **Interpretation:** stock scratch-blocks connection model (previous/next and statement inputs, snap radius).
- **Requirement:** Blockly-family engine with Scratch-style rendering, C-blocks, hats and reporters.
- **Test:** drag/snap/insert/nest/detach scenarios in an automated UI test.

### F3 Context menus, duplicate, delete, undo — VERIFIED
- **Observed:** block context menu = Duplicate, Copy Block, Delete Block, Add Comment, Export Block as Image. Workspace menu = Undo, Redo, Clean up Blocks, Add Comment, Delete N Blocks. Duplicate attaches the copy (block plus everything below it) to the cursor. Ctrl+Z first undoes the *move* of the duplicate, then its creation.
- **Requirement:** event-sourced undo stack that groups create+move like Blockly event groups.

### F4 Program execution (Stage mode) — VERIFIED
- **Actions:** clicked green flag, then stop.
- **Observed:** sprite x went 0 → 10 and direction changed continuously while running; after stop, values were stable. Running stacks glow.
- **Evidence:** `11_stage_running.png` (`ev_5068eb29…`). Field values were read through the driver.
- **Interpretation:** Scratch VM threaded runtime (green flag → hats → threads, stop-all).

### F5 Board selection & connection — VERIFIED (UI) / UNKNOWN (with hardware)
- **Observed:** Board modal with 16 boards. Choosing Arduino Uno adds board categories and immediately opens **"Connect to Port"** with *Serial Ports (USB)* / *Bluetooth Ports* tabs, showing "No devices found" and a Refresh button.
- **Evidence:** `07`, `08`.
- **Not tested:** a real device. No board was connected to this machine, so detection, firmware upload and live Stage-mode hardware I/O are **UNKNOWN**.

### F6 Upload mode & C++ generation — VERIFIED
- See §2. Generated header: `//This c++ code is generated by PictoBlox`. Boolean HIGH is emitted as `digitalWrite(13, true)`. `wait 1 seconds` is emitted as `delay(1 * 1000)`. The editor is **Ace** (`.ace_editor` present, no Monaco or CodeMirror).
- **Evidence:** `09`, `10` (`ev_6c11d064…`), `evidence/codegen_arduino_uno_sample.cpp`.

### F7 Compile & upload toolchain — INFERRED (static text)
- `arduino-builder -compile -logger=machine -hardware <arduino>/hardware -tools <arduino>/tools-builder -tools <arduino>/hardware/tools/avr -built-in-libraries <arduino>/libraries -build-path <tmp> -fqbn=arduino:avr:uno -libraries <saveCPPScriptsPath> -libraries <defaultCppModulesDirectory> <sketch>`. Machine-log lines (`===info ||| Sketch uses {0}`, `Progress {0}`) are parsed to drive progress UI.
- Upload: `avrdude -C avrdude.conf -patmega328p -carduino -P<port> -b115200 -D -Uflash:w:<hex>` (Uno). Mega/evive use `-patmega2560 -cwiring`. Nano variants use 57600/115200/19200 baud. ESP32-family boards use `esptool --chip esp32 --baud 921600 … write_flash` with partitions/boot files. Prebuilt firmware `.hex` files exist per board (e.g. `eviveFirmware.hex`).
- Bundled Arduino 1.8.5 with **59 libraries** (Servo, NeoPixel, DHT, MPU6050, Dabble, evive, …). `arduino-cli` appears only in a bundled library index (it is not the build driver).

### F8 Main-process services (IPC) — INFERRED (static text)
- **344** distinct `ipcMain.on/handle` channel names (`evidence/main_ipc_channels_static.txt`). Groups: serial (`SCAN_FOR_SERIAL_PORT`, `CONNECT_TO_SERIAL_PORT`, `SERIAL_WRITE`, `serialRead`), BLE (`SCAN_FOR_BLUETOOTH_PORT`, …), build/upload (`uploadCode`, `buildStart`, `buildComplete`, `uploadFirmware`, `eraseBoard`), Python runtime (`RUN_SPRITE_PYTHON_EXECUTION`, debugger step/breakpoints, `START_REPL_MODE`, `INSTALL_PIP_PACKAGE`, `START_PYLINT`), notebook (`START_NOTEBOOK`), MicroPython compile, file system, project save (`SAVE_FILE`, `SAVE_AS_FILE`, `PROJECT_SAVED`), updater, and the PictoBlox Link helper.
- Dependencies in package metadata: `serialport 10.4.0`, `node-ipc`, `express`, `socket.io`, `electron-store`, `electron-updater`, `systeminformation`, `sudo-prompt`.

### F9 Project storage — VERIFIED (format) / UNKNOWN (save flow)
- `.sb3` structure verified from a bundled sample (`defaultProjects/Arduino Uno/Arduino - Controlling Motor.sb3`). The user folder `~/Documents/Pictoblox/{ARProjects,BackUp,cpp_scripts,MLProjects,python_scripts}` exists, and `cpp_scripts/arduino.ino` is the build sketch location (INFERRED).
- Save/Open use native OS dialogs, which were **not exercised** (they would block an unattended session). Auto-backup behaviour is UNKNOWN.

### F10 Python environments — PARTIAL
- VERIFIED: the Python tab in Blocks/Stage mode is a **separate environment**. Switching shows "The block codes will not work parallelly with the python codes." It is *not* a view of code generated from blocks.
- INFERRED: bundled Python runtimes `ppy-basic/advance/ml`, a Jupyter notebook server, pylint and a debugger over IPC.
- UNKNOWN: whether Py Editor generates Python from blocks for any board, and MicroPython for ESP32/Quarky.

### F11 Extensions — VERIFIED (catalogue)
- About 35 extensions in 5 categories. The "Requires" badge shows extensions that depend on internet or an account. "Cannot be used on Stage mode" marks upload-only hardware extensions (Display Modules). See `REA_FEATURE_MATRIX.md`.
- UNKNOWN: the internal extension registration API (inside the 89 MB `scratchvm_.js` chunk, not yet analysed).

### F12 Electron security posture — VERIFIED (REA `inspect_electron_fuses`, `ev_33815109…`)
- RunAsNode **enabled**, NodeOptions env **enabled**, CLI inspect **enabled**, ASAR integrity **disabled**, OnlyLoadAppFromAsar **disabled**, cookie encryption **disabled**. Lesson for our IDE: flip these fuses in our own build.

## 4. Unknowns carried forward
1. Real-board detection, serial protocol of Stage-mode firmware, firmware auto-upload. Needs a connected Uno/ESP32/Tariro board.
2. Save/Open/auto-backup flows (native dialogs).
3. Extension registration API and block-definition format inside `scratchvm_.js` / `common_.js`. Next REA step: `analyze_javascript_application` on `build/chunks/*.js` with raised client deadline, or `trace_web_source_location` on the live renderer.
4. Python codegen from blocks and MicroPython path.
5. ML environment, 3D/XR studio, and PictoBlox Link (out of scope for the first iteration).

## 5. IP boundary
No PictoBlox source code, block artwork, sprites (e.g. "Tobi"), firmware or sounds will be copied into the new IDE. The reconstruction uses open-source Blockly (Apache-2.0), our own block definitions and generators, and Arduino CLI. If any upstream Scratch 3 package were adopted directly (scratch-gui/scratch-vm/scratch-paint: BSD-3-Clause; scratch-blocks: Apache-2.0), its licence terms would apply. Verify licences again at adoption time.
