# REA Component Map — PictoBlox 9.0.0

```
┌──────────────────────────── Electron main process (Node 16.5.0) ────────────────────────────┐
│ electron-build/main-bundle.js (7.1 MB webpack)                                               │
│  ├─ Express HTTP server  :21679  → serves build/ (GUI SPA)              [VERIFIED target URL] │
│  ├─ Socket server        :21677  (socket.io / node-ipc)                 [VERIFIED log]        │
│  ├─ ipcMain: 344 channels                                               [INFERRED static]     │
│  │   ├─ Serial  (serialport 10.4.0): scan/connect/write/read/baud                             │
│  │   ├─ BLE: scan/connect/firmware-version                                                    │
│  │   ├─ Build/Upload: arduino-builder → avrdude | esptool; firmware .hex/.bin; eraseBoard     │
│  │   ├─ Python: ppy-basic/advance/ml runtimes, REPL, debugger, pylint, pip, notebook          │
│  │   ├─ MicroPython compile, file system (FS map, cut/paste/rename)                           │
│  │   ├─ Project: SAVE_FILE / SAVE_AS_FILE / open-file / PROJECT_SAVED / backpack              │
│  │   └─ App: updater, store (electron-store), analytics flags, PictoBlox Link                 │
│  └─ spawned tools: resources/arduino-1.8.5/{arduino-builder,hardware,libraries(59)},          │
│                    avrdude, esptool, python/, notebook/, ffmpeg/, PictoBloxLink/, Tracker/    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                    ▲ IPC (ipcRenderer)                ▲ HTTP/WebSocket
┌────────────────────────── Renderer: http://localhost:21679/ (SPA) ──────────────────────────┐
│ gui.<hash>.js (bootstrap) + chunks/                                       [VERIFIED scripts] │
│  ├─ vendors_.js   32.7 MB  (React 16, Redux, libraries)                                      │
│  ├─ common_.js    28.5 MB  (PictoBlox GUI code)                                              │
│  ├─ scratchvm_.js 89.3 MB  (scratch-vm fork + extensions + codegen?)       [codegen: UNKNOWN] │
│  ├─ scratchblock_.js 7.4 MB (scratch-blocks fork / Blockly)                                  │
│  ├─ scratchpaint_.js 6.1 MB (paint editor)                                                   │
│  └─ lottie / dotlottie players                                                               │
│ UI regions [VERIFIED screenshots]: Menu bar · Mode toggle · Tabs (Blocks|Python/C++|Costumes │
│ |Sounds) · Category rail · Flyout · Workspace (zoom, undo/redo) · Stage / C++ pane · Log &  │
│ Serial Monitor · Sprite info · Sprite list · Stage/backdrops · Backpack · Extension button  │
│ Persistent state: localStorage, Firebase IndexedDB, Mixpanel IndexedDB      [VERIFIED keys]  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Renderer UI components (VERIFIED)

| Region | Elements |
|---|---|
| Menu bar | Logo, environment name, File, Edit, Learn, Board, Connect, connection icon, project title input, save icon, Mode (Stage/Upload), achievements, settings, language selector, Sign In |
| Editor tabs | Blocks, Python (Stage) / C++ (Upload), Costumes, Sounds |
| Category rail | Search, Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables, My Blocks + per-board/extension categories with icons |
| Workspace | Undo/redo, zoom in/out/reset, sprite watermark, scrollbars, context menus, Backpack drawer |
| Right side (Stage mode) | Green flag, stop, Upload Firmware, snapshot, layout toggles, full-screen, stage canvas, sprite properties (name, x, y, show, size, direction), sprite list, stage/backdrops, add sprite/backdrop FABs |
| Right side (Upload mode) | Code view toggle, (disconnect) icon, Upload Code, Ace C++ editor, Log / Serial Monitor tabs |
| Modals | Launcher, Board selector, Connect to Port (Serial/Bluetooth), Save prompt, Switching-environment warning, Extension library, Junior tutorial |

## Resource folders (VERIFIED filesystem listing)
`3DLibrary 3DTemplate 3DTexture 3DVideo 7zip-bin app.asar app.asar.unpacked arduino-1.8.5 defaultProjects defaultProjectsHorizontal ffmpeg ImageGenerator notebook PictoBloxLink python Tracker Tutorials videoEditorVideo`.
`defaultProjects/` has subfolders per board/domain (AI & ML, Arduino Uno, Common, ESP32, evive, python, pythonNotebook, quarky, Wizbot) containing `.sb3` samples.
