# REA Interaction Log — PictoBlox 9.0.0

Each row lists the action performed, how it was performed, the response, and the REA evidence.
"Driver" = `rea-tools/cdp.mjs` (CDP input events). It is used only because REA 6.9.0 cannot click or drag in this Electron target (see REA_REPORT §1). "REA" = an REA MCP tool call.

| # | Action | Via | Observed response | Evidence |
|---|---|---|---|---|
| 0 | `binary_session` | REA | REA 6.9.0 up, JS/Electron/web tool groups available, native decompilers not configured | session summary |
| 1 | `inspect_electron_fuses` on `/opt/PictoBlox/pictoblox` | REA | RunAsNode on, ASAR integrity off, OnlyLoadAppFromAsar off | `ev_33815109…` |
| 2 | Launch app with `--remote-debugging-port=9333 --inspect=9334` | shell | Splash → launcher; one CDP page target `http://localhost:21679/` | `runtime3.log` |
| 3 | Screenshot launcher | REA `capture_web_screenshot` | 9 environment tiles, Community sign-in modal behind it | `01_startup.png` `ev_e89d4525…` |
| 4 | `inspect_web_page` (DOM, a11y, storage) | REA | 2644 DOM nodes; hidden GUI already mounted (Blocks/Python tab, Undo/Redo, Add Extension); 9 scripts incl. `chunks/scratchvm_.js` (89 MB), `scratchblock_.js`, `scratchpaint_.js`; storage: Firebase + Mixpanel IndexedDB | `ev_a79f6fd8…` (`evidence/inspect_web_page_launcher.json`) |
| 5 | `capture_browser_scenario` connect mode | REA | **Refused**: `target_not_allowed` (service-worker policy unprotected in Electron) | error recorded |
| 6 | Click text "Blocks" | Driver | Hit hidden GUI menu text, no change | `02_after_click_blocks.png` `ev_8fc83835…` |
| 7 | Resize window to 1400×900 | Driver (main-process inspector) | Viewport 1366×699 (screen-limited) | — |
| 8 | Click first tile (Junior Blocks) | Driver | Junior Blocks editor plus "Welcome to Junior Blocks" tutorial modal; horizontal ScratchJr-style palette | `03_junior_blocks_welcome.png` `ev_2c6471f5…` |
| 9 | Skip → File menu | Driver | File: New, New Junior Blocks Project, Open, Save, Save As, File Sharing, Open File from Link or QR, Blocks Guide, Screen Recording | `04_junior_file_menu.png` `ev_ca1f4308…` |
| 10 | File → New | Driver | "Don't Forget to Save Your Project!" Yes/No/Cancel | driver text |
| 11 | No | Driver | Launcher shown again | driver text |
| 12 | Click "Blocks" tile | Driver | Blocks editor, Motion palette, Stage mode, sprite "Tobi" | `05_blocks_editor.png` `ev_f4a519a1…` |
| 13 | Events → drag `when flag clicked` to workspace | Driver | One top-level stack | driver workspace dump |
| 14 | Drag `forever` (first try dropped wrong block because the flyout was still scrolling) | Driver | Unconnected stray block → dragged away → re-dropped under hat → **snapped** | driver dump |
| 15 | Drag `move 10 steps` between hat and forever | Driver | **Spliced** in between (insertion) | driver dump |
| 16 | Drag `turn 15` into forever mouth | Driver | **Nested** in C-block | `06_program_built.png` `ev_8bcf41db…` |
| 17 | Click Python tab | Driver | Modal "Switching Coding Environment! … block codes will not work parallelly with the python codes." → Cancel | driver text |
| 18 | Board menu | Driver | Select Board modal, 16 boards | `07_board_selector.png` `ev_7e4beda5…` |
| 19 | Choose Arduino Uno | Driver | New categories (Arduino Uno, Actuators, Sensors, Display Modules, Dabble); "Connect to Port" modal (Serial USB / Bluetooth tabs, "No devices found") | `08_connect_port_dialog.png` `ev_af218073…` |
| 20 | Esc → Mode: Upload | Driver | Stage blocks greyed out; Python tab → C++; Ace C++ pane, Upload Code, Log/Serial Monitor | `09_upload_mode_arduino.png` `ev_30888f25…` |
| 21 | Drag `when Arduino Uno starts up`, `forever`, `wait 1`, `set digital pin 13 HIGH`, `set PWM pin 3 255` | Driver | C++ updated live after each drop; blocks above forever → `setup()`; `pinMode` hoisted | `10_arduino_program_codegen.png` `ev_6c11d064…` |
| 22 | Drag `reset timer` into forever | Driver | `loop()` now contains `lastTime1 = millis()/1000.0;`; global `//MACROS` section added | `evidence/codegen_arduino_uno_sample.cpp` |
| 23 | Mode: Stage → green flag | Driver | Sprite x 0→10, direction changing; script glows | `11_stage_running.png` `ev_5068eb29…` |
| 24 | Stop | Driver | Values stop changing | driver text |
| 25 | Add Extension button | Driver | Extension library, ~35 tiles, 5 filter tabs | `12_extension_library.png` `ev_aca3e912…` |
| 26 | Right-click block | Driver | Duplicate / Copy Block / Delete Block / Add Comment / Export Block as Image | driver text |
| 27 | Duplicate → place → Ctrl+Z ×2 | Driver | 1st undo reverts placement, 2nd removes copy | driver dump |
| 28 | Right-click workspace | Driver | Undo / Redo / Clean up Blocks / Add Comment / Delete 14 Blocks | driver text |
| 29 | `list_javascript_runtime_targets` on :9334 | REA | Main runtime `node.js/v16.5.0`; target excluded (asar path) | `ev_88377acb…` |
| 30 | `analyze_javascript_application` main-bundle | REA | MCP host timeout; earlier CLI run reused (`ev_1a4ae8bd…`) | `evidence/main-summary.json` |
| 31 | `export_evidence_bundle` | REA | 3 records exported | `evidence/rea_session_bundle.json` |

Not performed (and why): Save/Save As/Open (native OS dialogs would block); real upload and firmware flash (no board attached); variables, lists and My Blocks creation (scheduled for the next REA pass); Py Editor/Notebook/ML/3D (out of first-iteration scope).

Note: `REA_SCREENSHOTS/01_startup_main_window.png` and `evidence/01_home_inspect_web_page.json` (15:53) predate this log. They come from the earlier REA run in `~/rea-work`.
