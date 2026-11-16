# REA Feature Matrix — PictoBlox 9.0.0

Status: V = VERIFIED, I = INFERRED, U = UNKNOWN. "Priority" is for our IDE: P1 = first release, P2 = next, P3 = later or out of scope.

| Area | Feature | Status | Evidence | Priority |
|---|---|---|---|---|
| Shell | Launcher with environment tiles | V | 01 | P1 (Blocks, Code, later Python) |
| Shell | Menu: File/Edit/Learn/Board/Connect | V | 05 | P1 |
| Shell | Language selector (~70 locales) | V | a11y `ev_a79f6fd8` | P2 |
| Shell | Sign-in / community / analytics | V | 01, storage | P3 (not planned) |
| Blocks | Drag from flyout, snap, insert, nest, detach | V | 06 | P1 |
| Blocks | Zoom +/−/reset, scroll | V | 05 | P1 |
| Blocks | Undo/redo (grouped events) | V | log #27 | P1 |
| Blocks | Context menu: duplicate, copy, delete, comment, export PNG | V | log #26 | P1 (PNG export P2) |
| Blocks | Workspace menu: clean up, delete all | V | log #28 | P1 |
| Blocks | Block search category | V | 05 | P2 |
| Blocks | Backpack (cross-project snippets) | V (UI) | 05 | P2 |
| Blocks | Variables, lists, My Blocks (functions) | V (category present) / U (flow) | 05 | P1 |
| Blocks | Junior (horizontal, icon) blocks | V | 03 | P3 |
| Runtime | Stage mode: green flag, stop, threads, glow | V | 11 | P2 (sprite stage is optional for robotics) |
| Runtime | Sprites, costumes, sounds, backdrops | V | 05 | P3 |
| Hardware | Board selector (16 boards) | V | 07 | P1 (Uno, Mega, Nano, ESP32, Tariro) |
| Hardware | Board-specific categories added on selection | V | 09 | P1 |
| Hardware | Connect: serial USB list / refresh | V (UI, no device) | 08 | P1 |
| Hardware | Connect: Bluetooth | V (UI) | 08 | P2 |
| Hardware | Upload mode: disable stage-only blocks | V | 09 | P1 |
| Hardware | Live C++ codegen (setup/loop, hoisting, macros) | V | 10 | P1 |
| Hardware | Compile via arduino-builder + fqbn | I (static) | main-bundle | P1 (use arduino-cli) |
| Hardware | Upload via avrdude / esptool | I (static) | main-bundle | P1 (arduino-cli upload) |
| Hardware | Build progress parsed from machine log | I (static) | main-bundle | P1 |
| Hardware | Serial Monitor | V (UI) | 09 | P1 |
| Hardware | Firmware upload for Stage-mode live control | V (button) / U (protocol) | 05 | P2 |
| Hardware | Library manager (add C++ library / package) | I (IPC names) | ipc list | P2 |
| Text code | Ace C++ editor (read-only preview?) | V (Ace present) / U (editable?) | 09 | P1 (Monaco, editable) |
| Text code | Python editor, REPL, debugger, pip, pylint | I (IPC) | ipc list | P2 |
| Text code | Py Notebook (Jupyter) | V (tile) / I | 01 | P3 |
| Text code | MicroPython compile | I (IPC) | ipc list | P2 |
| Project | `.sb3` zip + `boardSelected` + `pictobloxVersion` + thumbnail | V | sample sb3 | P1 (own JSON format, sb3-like zip) |
| Project | New / Open / Save / Save As | V (menu) / U (flow) | 04 | P1 |
| Project | Unsaved-changes prompt | V | log #10 | P1 |
| Project | Example projects per board | V | defaultProjects | P2 |
| Project | Open from link / QR, File Sharing | V (menu) | 04 | P3 |
| Extensions | Library with filter tabs (AI&ML, Hardware, Robots, IoT, Games) | V | 12 | P1 (registry), content incremental |
| Extensions | Hardware: Advance Sensors, Display Modules, Stepper, Robotic Arm, Humanoid | V | 12 | P1/P2 |
| Extensions | IoT: IFTTT, IoT, Weather, Data Logger | V | 12 | P2 |
| Extensions | AI: face/object/body detection, ML env, TM, CV, OCR, speech, NLP, ChatGPT | V | 12 | P3 |
| Extensions | Pen, Music, Video Sensing, TTS, Translate | V | 12 | P3 |
| Tools | Paint, Screen Recorder, Video Editor, 3D/XR | V (tiles) | 01 | P3 (out of scope) |
| Security | Fuses permissive (RunAsNode on, ASAR integrity off) | V | `ev_33815109` | — (we harden ours) |
