# Tariro Studio platform expansion: Phase 1 assessment and plan

Date: 2026-11-17. Source brief: "Master platform expansion and engineering development prompt" (Omorfo Tech Labs).
Status (2026-11-20): **Phases 1–6 and 8 built. Phase 2 slices 2a–2e built and compile-verified (2f not started). Phase 3 (environments), Phase 4 (AI and vision, 4a–4f), Phase 5 (AI robotics; 5d the AI assistant left out until a provider is chosen), Phase 6 (Drone Studio) and Phase 8 (circuit check, diagram, debugger, diagnosis) built. Simulation Lab slices 7a–7c and 7e built; 7d and 7f–7i not started. Phases 9 and 10 not started. On real hardware only the Tariro's basics, its onboard motors and image training with a laptop webcam are verified; everything else has run on simulators, pretend boards and the compiler.**

This document is the implementation checklist the brief asks for. Each later phase updates the status tables at the end.

## 1. How the application was inspected

| Method | What it covered | Evidence |
|---|---|---|
| REA `inspect_web_page` on the running dev build (CDP) | DOM (913 nodes), accessibility tree (292 nodes), console, network, scripts | `ev_96b97d9e092…` (2026-11-17) |
| REA `capture_web_screenshot` | The redesigned interface, a category flyout, a real Verify | `REA_SCREENSHOTS/UI_redesign_*.png` |
| Code reading | All three packages, about 9,900 lines of TypeScript | this repo |
| Test suites | 175 unit tests, 29 end-to-end tests, example compile tests | `npm run ci`, Playwright |
| Real hardware | Tariro (Malkon SMRS): upload, serial, live mode, motors (2026-11-16) | `DEVELOPMENT_PROGRESS.md` |
| CRUMB reference | The public website only, read with a web fetch | section 5 |

What REA saw in the running app (accessibility tree): 21 buttons (theme, window controls, File, Extensions, Verify, Upload, Run live, undo/redo/zoom/fit, Edit as code, panel toggle, bin), 2 pickers (Board, Port), 4 tabs (Problems, Output, Serial Monitor, Plotter), 2 toolbars, 3 text boxes (project name, block search, editor), 2 resizable separators, 9 toolbox categories for the Tariro board. Network requests during the capture window: 0 (the app is offline-first). Console: Vite development messages only.

REA limits that matter for this programme:
- REA page tools only attach to `http(s)` pages, so they inspect the **dev build**, not the packaged `app://` build.
- REA cannot click or drag in this Electron target. Interactions are driven with a small CDP helper (`docs/rea-tools/cdp.mjs`) and then observed with REA.
- **CRUMB itself was not inspected with REA.** It is a paid desktop application that is not installed on this machine. Only its website was read. Section 5 says what that does and does not establish.

## 2. What exists today

Architecture: an npm-workspaces monorepo. Electron 44 main process (services, typed and validated IPC), sandboxed preload, React 19 renderer. Blockly 13 for blocks, Monaco for code, arduino-cli for compile and upload, `serialport` for USB.

| Area | What is built | Verified how |
|---|---|---|
| Blocks | 73 block types in 8 packs: core (34), pins and serial (9), Tariro motors (2), sensors (8), outputs (6), displays (6), Bluetooth (4), Wi-Fi (4) | unit + golden tests |
| Code generation | Arduino C++ for every block. MicroPython for core, pins/serial and Wi-Fi only (47 of 73) | golden tests; every example compiles with arduino-cli |
| Live mode | Blocks interpreted on the PC, board driven over Firmata. 38 of 73 blocks have a live handler | tests; real Tariro board incl. motors |
| Boards | Tariro (Malkon SMRS), Malkon One, Malkon ESP32-S3, Arduino Uno, Nano, Mega | **only the Tariro was tested on hardware** |
| Toolchain | Verify, Upload, library auto-install, on-demand board support, Firmata install, MicroPython upload over the REPL | fake CLI tests; real compile; real upload on Tariro |
| Serial | Port detection, Serial Monitor, Plotter | tests; real board |
| Projects | One `.tsp` file (zip: `project.json` + thumbnail), autosave, crash recovery, recent list, 12 examples | tests |
| Interface | Design system, dark/light, title bar, toolbox search, resizable panels, shortcuts | REA + 7 UI tests |
| Packaging | Bundle script and first-start setup exist. **No installer has been built.** | partly |

Not present at all: any stage/sprite environment, simulation, circuit design, camera use, AI or ML, AI assistant, drones, debugger beyond block highlighting, lessons, accounts, sharing, report export.

A correction to the brief: it says "expand the existing Tariro Basic Components category". **No category with that name exists.** The nearest things are the Sensors and Outputs extension packs. Phase 2 creates the category and moves those blocks into it.

## 3. Integration points (what the expansion will reuse)

These are the seams already in the code. Each planned area names the one it plugs into.

1. **Extension manifest** (`packages/core/src/types.ts`, `registry.ts`). One manifest carries a pack's blocks, toolbox, pinned libraries, board filter, C++ emitters, MicroPython emitters and live handlers. New components, actuators, vision, drone and autonomy blocks are new manifests. Nothing else needs to change for a pack to appear, be filtered by board and be searchable.
2. **Block interpreter and `LiveBoard`** (`core/src/live`). The interpreter runs the block program and calls an abstract board (`digitalWrite`, `analogRead`, …). Today the board is Firmata. **A simulated board implementing the same interface is how block programs will drive the Simulation Lab**, with the same program logic and no decorative animation. A drone, a camera model and the Creative Studio stage become further "machines" behind the same interpreter.
3. **Board definitions** (`core/src/boards.ts`). Pins, family, languages, USB ids, onboard peripherals. Needs to grow: interrupt-capable pins, timers, voltage, per-board capability flags.
4. **Typed IPC** (`core/src/ipc.ts`). Every renderer-to-main call is declared once and validated both ways. Camera, drone (UDP), model storage and file export get channels here; this is also where the hardware safety layer sits.
5. **Project file** (`core/src/project.ts`). A versioned, validated schema inside a zip. A zip can hold models, circuit layouts, images and reports as extra entries, so one project file can carry everything.
6. **Toolchain service** (main). Already installs pinned cores on demand, which is the base of a Board Manager.
7. **Renderer shell.** One window with a toolbar, a main area and a dock. New environments become lazily loaded "workbenches" in the main area, so a child using blocks never loads the 3D engine or an ML runtime.

## 4. Architecture decisions for the expansion

| # | Decision | Why |
|---|---|---|
| A1 | **Project format v2**: `project.json` gains optional sections (`circuit`, `simulation`, `stage`, `models`, `camera`, `report`, `history`), each versioned, plus binary entries in the zip. v1 files open unchanged. | One project system for every environment (brief §16, §24) |
| A2 | **Component definitions** as a new shared type: name, category, pins, electrical properties, 3D model reference, simulation behaviour, supported boards, the blocks that drive it, documentation. Extensions contribute them. | The same rotary encoder must appear in blocks, the simulator, the circuit designer and the digital twin (§13.11, §24) |
| A3 | **Machine interface**: generalise `LiveBoard` into capability-based devices (`gpio`, `encoder`, `servo`, `camera`, `drone`). Real hardware, the simulator and the digital twin implement it. | Simulation-to-hardware transition (§13.10) |
| A4 | **Execution safety layer in the main process**: every physical command passes validation, limits, logging and an emergency stop. Nothing in the renderer, and no AI output, can reach hardware except through it. | §10.1, §25 |
| A5 | **Capability flags** per board and per feature, with three honest states shown in the interface: *verified on hardware*, *implemented, awaiting hardware test*, *not available*. | §28 rules 5–8, 13 |
| A6 | **Lazy workbenches**: Blocks, Creative Studio, Simulation Lab, Vision AI, Drone Studio load on demand. | §26 |
| A7 | **Experience levels** (Beginner, Intermediate, Advanced) as a filter over toolbox categories and panels, stored per user. | §23 |
| A8 | **Local by default**: training and inference run on the device; nothing is uploaded without consent. | §25 |

Proposed building blocks (to be confirmed when each phase starts, not yet added):
- 3D: three.js (MIT), loaded only in the Simulation Lab.
- Circuit solving: our own modified-nodal-analysis solver for resistive and diode circuits with digital pins as sources. The interface will state what it models. No claim of SPICE accuracy.
- Firmware simulation for typed C++ (code mode): avr8js (MIT) can run the compiled AVR program; rp2040js does the same for the Pico. Block programs do not need this (see integration point 2).
- Machine learning: TensorFlow.js with a bundled MobileNet feature extractor for transfer learning, so training works offline. Pose and hand models via MediaPipe tasks, bundled.
- Drones: the Tello text SDK over UDP from the main process.

## 5. The CRUMB reference: what is and is not established

From the public website (web fetch, not REA): CRUMB is a circuit simulator for Windows, macOS and Linux in which circuits are built on a breadboard. The site names microcontrollers "running real firmware" (AVR, ESP32, Raspberry Pi Pico), logic chips, displays, sensors, motors and servos modelled as physical bodies, an oscilloscope, a multimeter and FFT that probe any node while the circuit runs, bus sensors (SPI, I²C, UART, 1-Wire), environment zones, a learning campaign with checked challenges, and user-made parts.

Not established: how its 3D workspace is navigated, its wiring gestures, its component property panels, its save format. The site does not describe them, and the application was not run. **Before Phase 7 is designed in detail, CRUMB needs to be installed here so REA (or screen capture) can document its interaction patterns.** That needs a licence purchase, which is your decision. Tariro's implementation, models and artwork will be original either way.

## 6. Honest sizing

The brief describes a product family that commercial teams build over years: a Scratch-like studio, a CRUMB-like 3D circuit simulator, a Teachable-Machine-like ML lab, a vision toolkit, a drone studio, an LMS with teacher dashboards, a community site and an AI assistant. It cannot be delivered as one piece of work, and several parts cannot be verified from this machine at all.

Three groups:

**Can be built and verified here** (software plus the one board on the desk): Basic Components and encoder blocks with compile tests; actuator and arm blocks; experience levels; project format v2; the simulator core (connectivity, solver, instruments, simulated board driven by the block interpreter); a 3D workbench; Creative Studio stage and runtime; drone simulator; camera access; on-device image-classifier training; colour, QR and marker detection; the safety layer; the debugger; report export; offline lessons.

**Can be built but only verified with hardware you provide**: every board other than the Tariro (micro:bit, Pico, Pico W, ESP32 variants, ESP8266, NodeMCU, and even the Uno, Nano, Mega and Malkon One already listed); real encoders, steppers, servos and arms; a Tello drone; robot-mounted and IP cameras. Until tested these are labelled "awaiting hardware test" (decision A5).

**Need a decision or a service that code alone cannot supply**:
- The **AI assistant** needs a language model. That means a provider, an API key, a cost, and a privacy position for children's data, because prompts leave the device.
- **Tariro Community**, **teacher dashboards**, **classroom management**, **sync** and **sharing** need a server, accounts, moderation and a child-privacy policy.
- **CRUMB** as a reference needs a licence (section 5).
- **Original characters and artwork** for Creative Studio: I can draw simple original vector characters; a brand illustrator would do better.

## 7. Roadmap

Each phase is delivered in slices. A slice is done only when it is implemented, tested, inspected in the running app with REA, and its status recorded below. Existing tests must stay green throughout.

| Phase | Slices, in order | Exit check |
|---|---|---|
| **2. Core hardware** | 2a Tariro Basic Components category (existing sensor/output blocks moved, LEDs, switches, potentiometer, LDR, relay, touch, line sensor added). 2b **Rotary encoders**: configure pins and pulses per revolution, count, direction, position, angle, RPM, speed, wheel distance, reset, compare, left/right wheel; interrupt-aware per board, with a polling fallback and a warning where a pin cannot interrupt. 2c Actuators: DC motors through L298N and TB6612FNG, servo sweep and multi-servo, steppers through A4988/DRV8825. 2d Robotic arm: joints, limits, home, gripper, sequences. 2e Encoder projects, PID and wheel synchronisation. 2f Component definitions (A2), board capability flags (A5), Board Manager panel. | Every block compiles for every board it is offered on; encoder blocks checked on the Tariro if an encoder is fitted |
| **3. Programming environments** | 3a Experience levels (A7). 3b MicroPython and live handlers for the Basic Components and Actuators packs. 3c Python environment. 3d Creative Studio: stage, sprites, costumes, events, motion, looks, sound, collisions, original characters. 3e Environment switcher on a shared project (A1). | Example projects run in each environment |
| **4. AI and Vision** | 4a Camera permission, source picker, preview, active indicator. 4b Image classifier: classes, capture, train on device, progress, accuracy, test, save into the project. 4c Vision blocks: start/stop camera, classify, class, confidence, threshold. 4d Colour, QR and ArUco detection. 4e AI Playground with overlays. 4f Audio classifier, pose and gesture. | A model trained on this machine drives a block program |
| **5. AI-powered robotics** | 5a Safety layer (A4) and emergency stop. 5b Vision prediction to motor commands through the safety layer. 5c Autonomy blocks: obstacle stop, colour follow, traffic light, encoder-corrected driving, PID. 5d AI assistant that reads the project and inserts real blocks (after the provider decision). | Traffic-light car in simulation, then on the Tariro |
| **6. Drone Studio** | 6a Drone blocks and a simulator with flight path, altitude and limits. 6b Tello link over UDP with telemetry, limits and emergency land. 6c Missions, record and replay. | Simulator verified; real flight only with a Tello and supervision |
| **7. Simulation Lab** | 7a Connectivity model and solver with unit tests (series, parallel, LED with resistor, switch, potentiometer). 7b Simulated board behind the block interpreter: a blink program lights a virtual LED. 7c 3D workbench: camera, breadboard, place/move/rotate, wiring. 7d Original 3D parts: resistor, LED, RGB LED, button, switch, potentiometer, buzzer, Uno, Nano, sensors, motors, servo. 7e Instruments: multimeter, oscilloscope. 7f Faults. 7g Robot and arm simulation with encoders. 7h AVR firmware simulation for typed code. 7i Wiring guide for moving to real hardware. | Blink, button, potentiometer-dimmer and motor projects behave the same in simulation and on the Tariro, with differences listed |
| **8. Circuit design and debugging** | Schematic and breadboard views over the same circuit data; validation and pin conflicts; debugger with stepping, breakpoints at blocks, variable and pin watch, live sensor readings; guided diagnosis that states possibilities, not certainties. | A wrongly wired example is flagged |
| **9. Learning and ecosystem** | Offline lessons with checks, progress on the device, achievements, report generator with PDF export, project history and restore, digital twin on the machine interface. Server-backed features only after the decisions in section 8. | A lesson can be completed and a report exported |
| **10. Integration** | Regression pass, hardware matrix, safety tests, REA pass over every environment, installers. | The 17 acceptance criteria, each with its evidence |

A sequencing note: the brief calls the Simulation Lab the flagship but places it seventh. Slices 7a and 7b depend on nothing in Phases 3 to 6 and would let every later feature be demonstrated without hardware. Moving them directly after Phase 2 is an option.

## 8. Decisions needed from Omorfo Tech Labs

1. **Order**: follow the brief's order, or bring the simulator core (7a, 7b) forward to follow Phase 2?
2. **AI assistant**: which model provider, who pays, and may learners' prompts leave the device?
3. **Online features** (community, classrooms, sync): is there to be a Tariro server, and who operates and moderates it?
4. **Hardware for testing**: which of the listed boards, encoders, steppers, arms, cameras and a Tello can be made available?
5. **CRUMB licence** for reference inspection.
6. **Installers (M7)** are half done. Finish them before the expansion, or alongside?

## 9. Status

Legend: ✅ implemented and verified · 🟡 partly · 🔌 implemented, awaiting hardware test · ⬜ not started.

### Acceptance criteria (brief §29)

| # | Criterion | Status | Note |
|---|---|---|---|
| 1 | Rotary encoders in Tariro Basic Components | 🔌 | Built: set-up, resolution, count, position, angle, direction, RPM, speed, wheel distance, reset, compare, absolute (analog and AS5600). Compiles for AVR and ESP32. **Not yet run with a real encoder** |
| 2 | Motors and robotic arms | 🔌 | Tariro onboard motors verified on hardware. Built and compile-verified only: DC motors on L298N/TB6612FNG, servo move and sweep, steppers on A4988/DRV8825, five-joint servo arm with limits, home, gripper and coordinated moves. No inverse kinematics |
| 3 | Program supported microcontrollers | 🟡 | Tariro verified; five other boards compile but are untested on hardware; micro:bit, Pico, ESP8266 and other ESP32s absent |
| 4 | Train own AI models | ✅ | Three kinds, all trained on this computer and saved in the project: pictures (MobileNet v2 features), sounds (a fingerprint of the microphone's spectrum, no model download) and body gestures (PoseNet body points). Up to 8 classes each, accuracy on held-back samples. Sound and gesture training checked with the fake camera and microphone and synthetic data only, **not yet with a real microphone or a person in front of a real webcam** |
| 5 | Camera access with permission | ✅ | The app asks the learner before the camera first turns on (remembered), shows "Camera on" in the status bar while it is, offers a camera picker and an off switch. The microphone (4f) works the same way: its own question, "Microphone on" indicator and off switch. The main process allows only the camera and microphone, only for the app's own pages |
| 6 | Computer vision in block programs | 🟡 | Stage mode: image classes, colours (seen, x, y, size), ArUco markers (seen, x, y, number), QR text, body points, gestures, sounds and loudness, plus the AI Playground to see what each finds. Not in Upload mode (the models run on the computer) |
| 7 | AI predictions control hardware safely | 🟡 | Safety layer (5a) in the main process: every command from live mode, Stage mode (including AI Vision decisions) and Python passes through it; clamps PWM and servo values, applies a motor speed limit, refuses bad pins and command floods, logs what it changed; a watchdog switches the board off if the app stops responding; an emergency stop (button and Esc) latches until Reset. Uploaded programs run on the board itself and are outside it. Not yet: the autonomy blocks of 5b–5c |
| 8 | Small autonomous cars | 🟡 | Upload mode (Tariro): drive until an obstacle (ultrasonic), follow a line (two sensors), drive a distance straight and turn an angle with the wheel encoders (with time limits); compiled with arduino-cli. Stage mode: a drive block, colour following and the AI traffic-light and colour-following car examples. Upload mode also holds both wheels at a set RPM with the encoders (PI control). **Not yet run on a real robot** |
| 9 | Drones with blocks | 🟡 | Drone Studio (Phase 6): drone blocks, a 3D flight simulator with limits, a DJI Tello link over UDP behind a main-process guard with emergency land, a pilot pad, recorded flights, replay and missions made from flights. **Verified on the simulator and a pretend Tello only; no real Tello has been flown** |
| 10 | 3D circuits in the Simulation Lab | 🟡 | 3D workbench: breadboard, generic microcontroller board, LEDs, resistors, buttons, slide switches, potentiometers and buzzers; place, drag, turn, remove; wires by clicking two points or from a pin picker; orbit, pan, zoom. **Not yet**: sensors, motors, servos and other boards as 3D parts; photographic detail. Since 2026-11-20: wires bend where the learner pulls them and their ends can be dragged to another hole or pin; the board and the breadboard can be moved anywhere on the bench (the board turned too); any of the six boards can be chosen on the bench, the Arduino Uno, Nano and Mega drawn with their real header layouts |
| 11 | Connect virtual components and simulate | ✅ | Breadboard connectivity rules (column strips, the centre gap, rails, wires, board pins) decide which nodes parts are on; the solver and the block program then drive them. Mistakes are explained: 5V wired to GND, two pins wired together, a part with all legs in one strip, two parts in one hole |
| 12 | Virtual instruments | ✅ | Multimeter (DC volts between two probes while running; ohms with the power off, LEDs reading open as on a real meter; amps through a chosen part), two-channel oscilloscope with time base, hold, min/max/average, frequency and duty, and a logic view of every pin in use. Probes placed by clicking holes, rails or pins in 3D, or from lists. PWM shows as its average voltage (stated in the panel) |
| 13 | Simulate microcontrollers and robots | 🟡 | Block programs run on a simulated 5 V AVR board through the same interpreter as live mode; the Tariro motors are simulated as driver channels. No servo, encoder, robot body or ESP32/Pico model; typed C++ is not simulated (7h) |
| 14 | Simulation to hardware | 🟡 | The Simulator tab lists how to wire the same parts on a breadboard, and the same project uploads to the real board. Not yet compared side by side on hardware |
| 15 | Debug programs and hardware | ✅ | Phase 8: compiler errors map to blocks; a block debugger (breakpoints from the block menu, pause, continue, step, variable and pin watches with sensor readings) on the simulator and in live mode, where pausing stops the motors; a circuit check that compares the program's pins with the workbench wiring (pin conflicts, LEDs in backwards or without a resistor, floating inputs, buttons that would short a pin); a circuit diagram of the same circuit; "Why isn't it working?" listing what it found, then what it cannot check. Live debugging checked against a pretend Firmata board only |
| 16 | One project system | ✅ | Blocks (or board code), the workbench, Creative Studio and Python are saved in the same `.tsp` project file (optional `circuit`, `stage` and `python` sections; older files still open) and switched between from the toolbar without losing anything. The AI, vision and drone environments will add their sections the same way |
| 17 | Existing functionality still works | ✅ | 447 unit + 68 end-to-end tests pass, lint and type checks are clean, and all 48 example/board combinations compile with arduino-cli, on 2026-11-21 (3 end-to-end tests failed once while the app was starting beside them, and passed when rerun) |

### Known issues carried into the expansion
- The Tariro board did not answer uploads on 2026-11-17 (the toolchain fails the same way outside the app); it worked on 2026-11-16. Hardware to be checked.
- Whole numbers print as "1.00" from block programs.
- Installers are not built; Windows and macOS are untested.
- MicroPython and live mode do not yet cover displays, Bluetooth, the colour sensor or the MPU-6050; steppers and encoders cannot run live (StandardFirmata has no stepper or interrupt counting). The app names each such block.
- MicroPython for the component packs is checked by running the generated code against stub hardware in CPython, not on a real ESP32.

### Phase 2 record (2026-11-17)

| Slice | What was built | Verified | Not verified / missing |
|---|---|---|---|
| 2a Basic Components | New built-in category on every board with sections: lights and sound, buttons and switches, sensors, rotary encoders, control, simple displays. New blocks: LED on/off, LED brightness, buzzer, switch; touch and line sensors added to the detector block. The old Sensors and Outputs categories are folded in; their block types are unchanged, so saved projects open as before. | Unit tests; REA capture `P2_basic_components.png` (25 blocks, 6 sections); e2e test | Resistors, capacitors and transistors have no blocks because they are not programmable parts; they belong to the circuit designer and simulator (Phases 7–8) |
| 2b Rotary encoders | 7 blocks. Counting happens in an interrupt on channel A; channel B gives direction. Boards now declare their interrupt pins (Uno-type: 2 and 3; Mega: 2, 3, 18–21; ESP32: all), and choosing another pin for A produces a warning that names the usable pins. Single-channel, quadrature, analog absolute and AS5600 magnetic absolute encoders. | Unit tests; compiles for Tariro, Uno, Mega and ESP32-S3 with arduino-cli | **No encoder was connected.** Counts, direction sign and speed have not been checked against a turning wheel. Pin-change interrupts (more encoder pins on Uno) are not used, to avoid clashing with the Bluetooth pack |
| 2c Actuators | DC motors (set-up, run, stop with coast or brake, two-wheel drive), servo timed move and sweep, steppers (set-up, speed and acceleration, move by steps/degrees/turns, go to position, zero, current on/off, position). | Unit tests; compile on AVR and ESP32 | No driver board or stepper was connected. Stepper moves block the program until finished |
| 2d Robotic arm | Up to five servo joints with limits and home angle, arm speed, single-joint move, coordinated four-joint pose, home, gripper open/close, joint angle. | Unit tests; compile on AVR and ESP32 | No arm was connected. **Inverse kinematics is not built** |
| 2e Projects and PID | Seven examples: measure wheel speed, drive 50 cm, drive straight (compare wheels), hold speed with PID, two-wheel driver robot, stepper turn, arm pick-and-place. PID block with its own state per block and anti-windup. | All 42 example-and-board combinations compile with arduino-cli 1.3.1 (AVR 1.8.7, ESP32 3.3.10) | PID gains in the example are starting values, not tuned on a motor |
| 2f Definitions and Board Manager | — | — | Not started: shared component definitions, capability flags in the interface, Board Manager panel, new boards |

MicroPython and live mode do not cover the new blocks yet (Phase 3b); the app says so when they are used there.
Tests after Phase 2: 219 unit tests, 31 end-to-end tests.

### Simulation Lab record, slices 7a–7b (2026-11-17)

Order changed at the user's request: the simulator core comes directly after Phase 2.

| Slice | What was built | Verified | Not verified / missing |
|---|---|---|---|
| 7a Circuit solver (`core/src/sim/solver.ts`) | Modified nodal analysis with Newton iteration: resistors, ideal voltage sources, diodes with an exponential characteristic (LED models by colour). Floating nodes are tolerated. | 11 unit tests: Ohm's law, series divider, parallel branches and Kirchhoff's current law, a balanced Wheatstone bridge, LED with 220 Ω (1.8 V, about 14 mA), reversed LED, LED with no resistor, mixed-colour LEDs in parallel, pull-up with a button | No capacitors, inductors, transistors or time behaviour. PWM is its average voltage. Not compared with SPICE or with measurements on a real circuit |
| 7b Simulated board (`core/src/sim/circuit.ts`) | `CircuitSimulator` implements the same `LiveBoard` interface as the Firmata link, so block programs run unchanged against the circuit. Pins have a 25 Ω output resistance and a 35 kΩ pull-up; input thresholds as on a 5 V AVR. Parts: resistor, LED, button, switch, potentiometer, buzzer, logic input (relay), motor driver channel, sensor signal. Warns about LEDs without a resistor and pins over 40 mA. | 10 unit tests; 7 tests of whole block programs driving the circuit (Blink, button-to-LED, potentiometer-to-brightness with printed readings, traffic light, Tariro motors) | Only 5 V AVR boards. Servo, encoders, tone, displays and the kit modules cannot run in the simulator yet and are refused with a message |
| Circuit from blocks (`extensions/src/circuit.ts`) | The parts are worked out from the program: an LED block on pin 9 gives an LED with a 220 Ω resistor on pin 9, a button block a button to GND, and so on. A wiring list explains how to build the same circuit on a breadboard. | Unit tests | The learner cannot add, move or rewire parts; that needs the workbench (7c) |
| Simulator tab (`renderer/src/sim/SimulatorPane.tsx`) | A second tab beside the code: part cards with live readings, a glowing LED whose brightness follows the solved current, spinning wheels for motors, hold-to-press buttons, switches and potentiometer sliders, pin and supply meters, problems, the wiring list. Run and Stop; the running block is highlighted. | REA capture `SIM_motors_running.png` (motor example running, both motors at 60 %, pins 4–7 measured); 3 e2e tests | 2D only. **The 3D workbench, free part placement and wiring are not built.** CRUMB has still not been inspected (needs a licence) |

Defect found by REA while checking the tab: the Run button sat off the right edge of a narrow code column and could not be clicked. Fixed by letting the code tab's label shrink; re-checked in the app.

### Simulation Lab record, slice 7c: the 3D workbench (2026-11-17)

| Area | What was built | Verified | Not verified / missing |
|---|---|---|---|
| Breadboard model (`core/src/sim/layout.ts`) | Half-size breadboard: 30 columns, rows a–j, centre gap, four rails, 2.54 mm pitch. Part footprints for LED, resistor, push button, slide switch, potentiometer and buzzer. Connectivity by union-find over strips, rails, wires and board pins; each group is named after the pin it reaches. Placement checks, first free spot, free hole in a strip, nearest hole. Lays out a circuit worked out from the blocks on the breadboard with its wires. | 9 unit tests, including a hand-built LED circuit lit by the simulator and a built-from-blocks circuit that behaves like the original (LED, button, potentiometer) | Four-leg buttons, transistors, capacitors, sensors and modules are not workbench parts yet |
| Project file | Optional `circuit` section in `project.json`, validated; older projects open unchanged; an empty bench is stored as none, so it never marks a project changed | Unit test (save and reopen) | — |
| One shared simulation (`renderer/src/sim/useSimulation.ts`) | The Simulator tab and the workbench show the same simulation. A project with parts on the bench simulates the bench; otherwise the circuit is worked out from the blocks. | e2e | — |
| 3D scene (`renderer/src/bench/scene.ts`, three.js 0.186.1, MIT) | All models drawn from primitives in this repo (original): breadboard with printed holes, letters, numbers and rail stripes; a generic board labelled with the selected board's name and pins; LED with lens and glow driven by the solved current; resistor with its real colour bands; button that moves when pressed; switch; potentiometer whose knob turns; buzzer that pulses when sounding; jumper wires as curved tubes. Orbit, pan, zoom, reset and top views; render on demand; loaded only when the workbench is opened (separate 1.4 MB chunk). | REA captures `BENCH_blink_running.png`, `BENCH_default_view.png`, `BENCH_blink_final.png` (Blink running on a bench built from the blocks: resistor 2.86 V, LED 1.81 V at 13 mA); e2e checks the canvas draws a scene | Only run on this Linux machine's Intel graphics. Low-end and Windows GPUs untested; a no-WebGL message exists but was not triggered |
| Interaction (`renderer/src/bench/Workbench.tsx`) | Parts palette (adds at the first free place), drag to move (by the body or any of its holes), Turn, Remove, Clear; Wire tool (click two holes or pins) with colours; properties panel with colour, resistance, live readings, what each leg is joined to, and a "Wire to…" pin picker; operate buttons, switches and knobs while running; hover hints naming the hole and what it is joined to; keys Delete, R, W, Esc. "Build from blocks" lays out the circuit the blocks imply. | 3 e2e tests: build-and-run, add/wire/turn/remove with problem messages, and mouse wiring and dragging in 3D | No undo on the bench yet (Ctrl+Z applies to blocks). No multimeter probes or oscilloscope (7e) |

Defects found while checking with REA and the 3D captures, all fixed: Run button off-screen in a narrow code column; parts too small to grab (now picked by their holes too); the side panels covering the bench (the camera now centres the bench between them); a leg joined to another part through a strip was described as "not connected to the board"; a tooltip stayed up after Run turned into Stop; the resistor had no picture in the Simulator tab; a removed three.js shadow setting.

### Simulation Lab record, slice 7e: virtual instruments (2026-11-17)

| Area | What was built | Verified | Not verified / missing |
|---|---|---|---|
| Simulator (`core/src/sim/circuit.ts`) | Every node voltage is now reported. `measureResistance(a, b)` solves the circuit with the power off and a 0.3 V test source, so series and parallel networks read correctly, LEDs read open and an open button reads OL. | 6 unit tests: a resistor network checked by hand (1 kΩ ∥ 5.4 kΩ, 1.6 kΩ), LED and open button OL, potentiometer ends and wiper, reading unaffected by a running program; node voltages including the point between a resistor and an LED | No capacitance or inductance, so no frequency-dependent readings |
| Measurements (`core/src/sim/measure.ts`) | Time-weighted min, max and average; frequency from rising edges through the midpoint; duty cycle; SI formatting with OL. | 5 unit tests (Blink 0.5 Hz / 50 %, 10 Hz / 25 %, steady level, formatting) | — |
| Instruments panel (`renderer/src/bench/Instruments.tsx`) | Multimeter with an LCD-style reading and Volts / Ohms / Amps; oscilloscope with two channels, 10 ms to 2 s per division, 1 V per division, hold, and per-channel statistics; logic view with a HIGH/LOW timeline per pin. Probes: red and black for the meter, yellow and cyan for the scope, drawn in 3D where they touch. The properties panel steps aside while the instruments are open. | 3 e2e tests: meter reads 5 V, 220 Ω, OL for an LED and 12–13 mA through the LED while Blink runs; scope reads Blink at about 0.5 Hz, 50 % duty, 4.67 V peak, and the logic view toggles; probes placed by clicking a board pin and a rail, with a note when a probe touches nothing. REA capture `INST_scope_blink.png` | No trigger on the scope (it rolls). Sampling is every 20 ms, so pulses shorter than that are missed. No FFT. An ammeter is not wired in series as a real one must be; the panel says so |

Found while checking: the oscilloscope was cramped between the side panels (it now takes the full width while open), and a frequency of 0.495 Hz was shown as "495 mHz", which is correct but confusing for learners (now "0.495 Hz").

### Phase 3 record, slices 3a–3c (2026-11-17)

**3a Experience levels.** Beginner, Intermediate or Advanced, chosen in the toolbar and remembered on this computer. Toolbox entries carry the lowest level that shows them; the registry drops labels and categories left empty. Beginner keeps start, loops, waits, decisions, simple maths, variables, pins, lights, buttons, simple sensors, the Tariro motors and a servo; Intermediate adds timing, text, serial, functions, encoders, motor drivers, steppers and the arm; Advanced adds PID, encoder tuning, stepper positioning and serial input. Programs that already use higher-level blocks open and generate whole. Default: Advanced, so no existing user loses blocks (a decision for Omorfo Tech Labs to revisit). Levels filter the toolbox and search only, not panels. Evidence: `levels.test.ts`, e2e `P3:`, `REA_SCREENSHOTS/P3_level_beginner.png`.

**3b MicroPython and live mode for the component packs.** Live mode now runs DC motors on drivers, servo move and sweep, the robotic arm, the 7-segment digit and PID, with a per-run memory in the interpreter for set-up state. The simulator refuses servo and arm blocks by name ("does not model servo motors yet"). MicroPython (ESP32) now covers the Basic Components (LEDs, buzzer, switch, encoders on pin interrupts, absolute and AS5600 encoders, PID), sensors (button, analog level, detectors, HC-SR04, DHT11/22) and every Actuators block, mirroring the C++ helpers' limits and timing. Verification: the generated Python is run in CPython against a stub `machine` module (`test/upy_run.py`) and must make the same pin changes as live mode for the same blocks (DC drive, servo timing, arm limits, 7-segment, PID values); encoder counting, sensor conversions and stepper timing are checked separately. **Not run on a real ESP32.**

**3c Python environment.** General-purpose Python 3 (3.14, Pyodide 314.0.7, MPL-2.0) runs on this computer in a worker, shipped with the app so it works offline. A `tariro` module drives the board over the live-mode USB link (`board.digital_write`, `digital_read`, `analog_read`, `pwm_write`, `servo_write`, `wait`), connecting on the first board command and switching pins off after Stop or an error. Stop ends waits and board calls at once and cannot be caught by `except Exception`; a loop that never waits is ended by restarting the worker. Errors show the learner's line and a traceback without the runtime's own frames; `input()` fails clearly (no console input yet). The program is saved in the project. Five examples. Evidence: `core/test/python.test.ts` (real Pyodide in Node), e2e `PY:` (prints, errors, save and reopen, blinking the mock Firmata board, Stop of a busy loop), `REA_SCREENSHOTS/P3_python_environment.png`. Not yet: running Python against the simulator, `input()`, installing extra packages, generating Python from blocks.

### Phase 3 record, slices 3d–3e (2026-11-17)

**3d Creative Studio.** A stage (480 × 360, centre origin, y up) with sprites, costumes, backdrops and sounds, programmed with its own block categories: Events (green flag, key, sprite click, broadcast and receive, broadcast and wait), Motion (move, turn, go to, glide, point, change and set x/y, bounce, x/y/direction), Looks (say and think, say for seconds, costumes, backdrops, size, show/hide, front layer), Sound (eight synthesised sounds, notes), Control (wait, repeat, forever, if/else, wait until, repeat until, stop), Sensing (touching edge, mouse or a sprite, keys, mouse, distance, timer), Operators and per-sprite variables. Every sprite has its own scripts; all scripts run together, one loop round per frame, so Stop always works. Sprites are added from a library of original characters drawn for Tariro (Tari the robot, rocket, fish, butterfly, ball, star, apple, paddle, block) on six original backdrops (including a coordinate grid); sounds are synthesised, so no artwork or audio is copied from anywhere. Sprites are placed by dragging them on the stage or by typing x, y, size and direction. The stage is saved in the project. Evidence: `core/test/creative.test.ts` (12 runtime tests with a virtual clock), e2e `CS:` (starter stage, adding a sprite, a key script built by dragging blocks, save and reopen), `REA_SCREENSHOTS/P3_creative_studio.png`.

Limits, stated: touching uses each costume's upright bounding box (not its outline, and not turned with the sprite); sprites always rotate all the way round (no left-right rotation style); no clones, lists, pen, `ask`, custom sounds or costume painting yet; variables belong to one sprite (no stage-wide variables); the green flag starts from the positions set in the editor (a run does not move the saved sprites). The characters are simple vector drawings; a brand illustrator would do better (§6).

**3e Environment switcher.** The toolbar's Blocks / Workbench / Creative / Python switch moves between environments on one project; each keeps its own section, and switching never discards work. Not built: generating Python from blocks, or Creative Studio blocks that drive the board (a natural next step through the live-mode link).

### Interface version 3 and Stage / Upload modes (2026-11-17)
At Omorfo Tech Labs' request the interface was redesigned to feel friendlier and less generic: light by default, rounded type, our own two-tone icons, a toolbox of colour circles, colour-coded actions. Creative Studio became **Stage mode** inside Blocks, beside **Upload** and **Python**. Stage mode can use the board's blocks in sprite programs (17 block types: pins, LEDs, buzzer, switch, button, analog level, detectors, servo, RGB LED, traffic light, relay, Tariro motors); they run over the live-mode link, so they need the live firmware on the board, and readings lag by up to one refresh (about 33 ms). Not in Stage mode yet: ultrasonic, DHT, encoders, motor drivers, steppers, arm. Evidence: `extensions/test/stage-board.test.ts`, e2e `STAGE:`, `REA_SCREENSHOTS/UI3_*.png`.

### Phase 4 record, slices 4a–4c (2026-11-17)

**Model.** MobileNet v2, width 0.35, 224 × 224, no top (Apache-2.0, the feature extractor Teachable Machine uses), downloaded once with Omorfo Tech Labs' approval and shipped inside the app (`packages/app/models/mobilenet-v2-0.35/`, source and checksums in its README). TensorFlow.js 4.22 (Apache-2.0), WebGL with a CPU fallback, loaded only when an AI feature is first used.

**4a Camera.** Asked before first use (answer remembered), camera picker, preview, "Camera on" indicator, off switch. The main process allows only video, only for the app's own pages; microphone, location and everything else stay denied. (4f later allows the microphone too, behind its own question.)

**4b Image classifier.** "Teach AI" in Stage mode: classes (rename, add up to 8, clear, delete), "Hold to record" (about 8 pictures a second, up to 200 per class, thumbnails), training on this computer (one softmax layer, Adam, 60 epochs), accuracy on held-back pictures (a fifth of each class with 10 or more), live confidence bars. Each picture is kept as 1,284 bytes of features, not the photo, plus 12 small thumbnails per class; everything is saved in the project (`ai` section). Evidence: `core/test/ai.test.ts` (storage, training on synthetic features, and the real bundled MobileNet telling red, blue and striped pictures apart in Node), e2e `AI:` (fake camera: consent, recording, training, saving), `REA_SCREENSHOTS/P4_ai_classifier.png`.

**4c Vision blocks** (Stage mode, AI Vision category): when AI sees [class], AI sees, AI sees [class]?, confidence of [class] %, turn video on / on flipped / off (the camera picture behind the sprites). "Seen" means at least 60 % sure. Evidence: runtime test for the hat (fires once per change).

Real webcam: Omorfo Tech Labs confirmed on 2026-11-17 that training and recognition work with the laptop's HP HD webcam (the automated tests use Chromium's fake camera). Not built yet: vision in Upload mode or Python. (4d–4f: see below.)

### Phase 4 record, slices 4d–4f (2026-11-20)

**4d Colour, QR and ArUco detection** (`core/src/vision/`, plain TypeScript on camera pixels, no model). Colours: nine named colours (red, orange, yellow, green, blue, purple, pink, white, black) by hue, strength and brightness; for each, whether it is seen (at least 0.5 % of the picture), where its middle is and how big it is. ArUco: our own detector for the original ArUco dictionary (1,024 markers, 5 × 5 bits): adaptive threshold, outlines, four corners, perspective correction, then the bits read in any of four turns; Print markers shows markers 0–11 to print. QR codes: jsQR 1.4.0 (Apache-2.0), downloaded with Omorfo Tech Labs' approval. Detection runs on a 320 × 240 copy of the camera picture about seven times a second.

**4e AI Playground** (Stage mode → Playground): the live camera with what each tool finds drawn over it (colour boxes, marker outlines and numbers, the QR code and its text, the body skeleton), switches for each tool, a readout, and the trained image, gesture and sound models' answers. Nothing is recorded.

**4f Sounds, body pose and gestures.** Sounds: the microphone (asked first, like the camera; "Microphone on" indicator) gives a spectrum every 25 ms; a second of it becomes a 96-number fingerprint (24 mel bands in four quarter-second slices, relative to the second's average level), and the same trainer as for pictures learns the classes, starting with "Background noise". Pose: **PoseNet MobileNet v1 0.75** (Apache-2.0, 2.5 MB, stride 16, from Google's tfjs-models storage), shipped in `packages/app/models/posenet-mobilenet-075/` with its source and checksums. MoveNet, the newer model, was the first choice but is only on TF Hub / Kaggle behind a login, so Omorfo Tech Labs chose PoseNet. Gestures: the 17 body points made relative to the shoulders (so position and distance from the camera do not matter) and trained like the other kinds. Projects gain `sound` and `gesture` sections.

**Blocks** (AI Vision): colour seen / x / y / size, marker seen / x / y / number, QR text, body seen, x / y of a body point, gesture, gesture is, sound heard, sound is, loudness, and buttons to teach gestures and sounds or open the Playground. Stage mode warns when a program uses gestures or sounds that have not been taught.

**Evidence.** Unit tests: `core/test/vision.test.ts` (markers at several numbers, turns, sizes, two at once and one seen from the side; nothing found in noise or a black square; colour names and a colour card; a QR code made by a small encoder in `core/test/fixtures/qr-encode.ts`), `core/test/sound-pose.test.ts` (fingerprints, compact storage, a sound classifier learning a hum from a whistle, pose decoding, gesture features unchanged by position and size). End-to-end `AI: the Playground finds a marker, a QR code and a colour…`: the fake camera plays a picture drawn by the test (marker 7, a QR code saying "Tariro 4e", a red card) and the Playground reads all three; pose loads and sees no one; the microphone waits for consent. Screenshots: `REA_SCREENSHOTS/P4_playground.png`, `P4_marker_sheet.png`.

**Not verified with real hardware:** markers and QR codes held up to a real webcam, colours under real lighting, PoseNet on a real person, and sound training with a real microphone. The automated tests use Chromium's fake camera and microphone and pictures drawn in code.

### Phase 5 record, slice 5a: the safety layer (2026-11-17)

Every command that drives a real board passes through `SafetyLayer` (core, `safety.ts`), inside the main process's live service: from live mode, Stage mode (and so from AI Vision decisions made there) and Python. The renderer has no other way to reach hardware.
- **Limits:** PWM 0–255 and servo angle 0–180 are clamped; a motor speed limit (10–100 %, set under Connect) caps the onboard motor driver's speed pins; pins and analog channels the board does not have are refused; more than 600 output commands a second is refused as a runaway loop.
- **Log:** the last 300 decisions are kept; anything limited or refused is reported in the Output tab (at most once a second per message).
- **Watchdog:** the app sends a heartbeat twice a second; after 1.5 s without one, the board is switched off.
- **Emergency stop:** a pulsing E-STOP button whenever a program drives the board, and Esc; it switches every pin off, stops live, Stage and Python programs, and latches (connecting is refused) until Reset in the red banner.
- Limits: programs uploaded onto the board run on its own processor and are outside the safety layer (E-STOP cannot reach them); the motor limit knows only the onboard driver's pins (motors on external drivers are limited only by the 0–255 clamp).
Evidence: `core/test/safety.test.ts` (7 tests), `app/test/live.test.ts` (motor limit on the simulated board, emergency stop latch, watchdog), e2e `SAFETY:`, `REA_SCREENSHOTS/P5_safety_running.png`, `P5_safety_estop.png`. Not yet run on the real Tariro.

### Phase 5 record, slices 5b–5c (2026-11-17)

**5b Vision drives the robot.** A "drive [forward / backward / turn left / turn right / spin left / spin right] at N % speed" block for the Tariro's two motors works in Upload mode (C++), live mode and Stage mode, so an AI Vision decision in a sprite program moves the robot, always through the safety layer (5a). AI fail-safe: if recognition stops answering for more than a second while the program uses the board (camera off or stuck, app busy), the AI counts as seeing nothing and the stage stops the motors itself, saying why. Example "AI traffic-light car" (Stage mode): video on; Green → drive and run animation; Red → stop; not sure → stop and wait. It ships with the classes Green, Red and Nothing named and empty; learners teach them with their own cards.

**5c Autonomy blocks** (Tariro category, Upload mode; they rely on sensor timing that the live link cannot give):
- drive forward until something is closer than N cm (ultrasonic; no echo counts as far away), then stop;
- follow the line one step (two line sensors, HIGH on the line; steers back and searches the way it last saw the line);
- drive straight N cm with the wheel encoders (P correction between the wheels; gives up after 15 s);
- turn N degrees on the spot with the wheel encoders and the wheel spacing (gives up after 10 s).
Examples "Drive a square, then stop at a wall" and "Follow a black line". Evidence: `extensions/test/autonomy.test.ts` (generated code, live and Stage drive, the example's behaviour without a model), compile tests (45 of 45), e2e `P5:`, `REA_SCREENSHOTS/P5_ai_traffic_light_car.png`.

Not verified on hardware: the drive block and autonomy blocks have run only against simulated boards and the compiler; the encoder moves need encoders fitted and their gain (8) may need tuning on a real robot. Not built then: colour following and speed holding (added on 2026-11-20, below), and 5d the AI assistant (waits on the provider decision in §8).

### Phase 5 record, colour following and speed holding (2026-11-20)

Phase 5 is complete apart from 5d. On 2026-11-20 Omorfo Tech Labs chose to leave out the AI assistant for now: nothing leaves the computer until a provider, who pays, and a policy for learners' prompts are decided (§8).

**Colour following** (Stage mode, AI Vision): "follow [colour] one step at N % speed, stop when it fills N % of the picture", for a forever loop. Each step drives towards the colour: the further it is from the middle of the picture, the faster the outer wheel and the slower the inner one (`core/src/vision/follow.ts`). It stops the motors when the colour is not seen, when it fills the given share of the picture (close enough), or when the camera has given no fresh picture for a second. It drives the Tariro's own motor blocks, so every command goes through the safety layer (speed limit, E-STOP). It assumes a camera on the robot looking forward (a USB webcam on a long cable or a phone used as a webcam; the camera picker chooses it). Example: "AI colour-following car" (no training needed). The AI fail-safe now also watches the colour, marker and pose detectors, not only the image model.

**Speed holding** (Upload mode, Tariro → Autonomy, advanced): "hold both wheels at N RPM going forward/backward using the wheel encoders, at most N % power", for a forever loop. One PI controller per wheel, from the encoder's speed to the motor's power (Kp 0.2, Ki 1.5), with anti-windup: the integral grows only while the power is below the limit, so a jammed wheel cannot store up a burst. The gains were chosen in a simulation with a coarse encoder (40 counts a turn, read every 50 ms); stronger gains made the power jump between readings. Example: "Hold a steady speed".

**Evidence.** `core/test/follow.test.ts` (steering, stopping); `app/test/colour-follow.test.ts` (the block drives the real Tariro motor handlers: PWM 153 and 51 for a card on the right; stops when the card is close, lost, or the detections are stale); `extensions/test/hold-speed.test.ts` (generated code; the uploaded C++ controller compiled with g++ and run against a strong and a weak simulated motor with a dead band and lag: both within 5 % of 90 RPM by 1.5 s with no overshoot over 15 %; a slope on one wheel made up within 2 s; power never above the limit; a wheel jammed for 3 s does not overshoot when released); the new example compiled with arduino-cli; e2e `AI: the colour-following car steers the Tariro motors…` (fake camera picture with a red card, pretend Firmata board: both motors forward near 35 %). Screenshots: `REA_SCREENSHOTS/P5_colour_follow.png`, `P5_hold_speed_block.png`.

**Not verified on hardware:** colour following with a camera on a real robot, and speed holding with real encoders. The gains may need tuning for the Tariro's motors and encoders.

### Workbench: free wires, movable board and breadboard, any board (2026-11-20)

Asked for by Omorfo Tech Labs: wires that move freely, boards placed anywhere, and more boards than the Tariro.
- **Wires**: drag a wire to pull a bend into it (it lies through its bends just above the parts); drag a bend to move it, double-click it to take it out, or "Straighten". Drag either white end to another hole or pin to re-plug it. Bends are saved (`via` on each wire).
- **Board and breadboard**: click to select, then drag anywhere on the table; the board also turns in quarter turns and goes "Back to its place". Wires and parts stay plugged in and follow. The two cannot be dropped overlapping. On the robot car the board stays on the deck. Saved as `boardAt` and `breadboardAt`; older projects open exactly as before.
- **Any board**: a picker under Board in the workbench's list (and in the board's details) offers all six boards; choosing one makes the project that board's. The Arduino Uno, Nano and Mega 2560 now have their own 3D models with their real header layouts (Uno: D0–D13 along one edge, power and A0–A5 along the other, SDA/SCL as A4/A5; Mega: D14–D21, the D22–D53 double header, A0–A15, SDA/SCL as D20/D21; Nano: two rows). The Malkon ESP32-S3 keeps the generic board, because its header positions are not confirmed.
- **Evidence**: `core/test/bench-place.test.ts` (5: models, Uno and Mega layouts, pins following a moved and turned board, old projects unchanged); e2e `BENCH: any board on the bench; wires bend and re-plug, and the board and breadboard move anywhere`. Screenshot: `REA_SCREENSHOTS/BENCH_free_wires_board.png`.
- **Breadboard size and turn** (2026-11-21): half size (400 holes, 30 columns, the default) or full size (830 holes, 63 columns), chosen under Breadboard in the list; holes keep their place, so a project keeps its wiring when it grows. It refuses to shrink while a part or wire is past column 30. The breadboard turns in quarter turns like the board, its parts and wires with it, and clicking finds the right hole however it is turned. If a turn makes it overlap the board, the bench says so. Saved as `breadboardSize` and `breadboardAt.turn`.
- **Horizontal or vertical, for every component** (2026-11-21): each part, the board, the breadboard and the robot car has Horizontal / Vertical and Turn in its details. Parts now turn all four ways (0°, 90°, 180°, 270°), about their own middle when there is room, so an LED turned end for end stays in its two holes with its legs swapped; the car starts facing the way it is turned and drives that way. Motors on the board's terminals turn with the board.
- **The board never sits on the breadboard** (2026-11-21): a turn, a bigger breadboard or a bigger board that would put them on top of each other moves the board the shortest way off it, in the same step (one undo puts both back). A project opened with them overlapping is fixed when it opens, and dragging uses the same rule. Checked by `benchOverlap` / `separateBoard` in core, from each board's outline. Screenshot: `REA_SCREENSHOTS/BENCH_board_moved_aside.png`.
- **Undo and redo** on the workbench (buttons on its bar, Ctrl+Z and Ctrl+Y / Ctrl+Shift+Z), up to 100 steps, for everything done on the bench: placing, moving, wiring, bending, turning, resizing, removing. A change from outside the bench (opening another project) starts the history again, so undo never brings back another project's circuit.
- **Evidence (added)**: `core/test/bench-place.test.ts` now 7 tests (sizes, holes and parts per size, the turn and its reverse); e2e `BENCH: a full-size breadboard that turns, and undo and redo on the workbench`. Screenshot: `REA_SCREENSHOTS/BENCH_full_breadboard.png`.
- **Limits**: parts still go on the breadboard (or the board's motor terminals); there is one board on the bench at a time, because a project's program is for one board.

### Phase 8 record: circuit check, diagram, debugger, diagnosis (2026-11-20)

Exit check met: the "Find the wiring mistakes" example (an LED in backwards, a button input that floats) is flagged in the Simulator tab, on the workbench, in Problems and in "Why isn't it working?", and the check is clean once the learner fixes both.

**8a Pin conflicts and the circuit check.**
- The code generator now records every pin a program sets up (`GeneratedProgram.pins`). It warns on a block that needs a pin set up differently from an earlier block (before, the first set-up silently won and, for example, a button sharing an LED's pin never read properly), and on a block that uses a pin wired to the board's own motor driver. Encoders now declare their pins too.
- `checkWiring` (`core/src/sim/check.ts`) compares those pins with the workbench: a pin the program uses with nothing on it; an input with only an LED on it; a button that would short an output pin; a pull-up input whose button goes to 5V; an input that floats while its button is up (with the right fix for a button to GND or to 5V); and, by trying the circuit in the simulator with the outputs HIGH then LOW, an LED in backwards or with no resistor. Findings show in the Simulator tab, on the workbench and in Problems ("circuit"); they never stop the learner running the program to see what happens. Examples can now carry a workbench (`layout`).
- Limits: pins set up inside helper code (external motor drivers, steppers, 7-segment displays) are not tracked yet; the check knows the parts the workbench offers.

**8b Circuit diagram** (`core/src/sim/schematic.ts`, Simulator tab): the same circuit as the breadboard (or the one worked out from the blocks), drawn as rows from a board pin through each part to GND or 5V, with labels on the legs of anything that is not a simple chain. Live state on it: LEDs glow, buttons close (and can be pressed there). An LED is drawn the way it is wired, so one in backwards points back at its pin and says so.

**8c Debugger** (Debugger tab): right-click a block → Add breakpoint (dashed red outline). Programs run on the simulator or live on a board stop before that block; Pause stops anywhere; Step runs one block (into loops and ifs); Continue goes on; Stop works while paused. Variables and the pins the program wrote or read (sensor readings included) are shown while it runs. Time spent paused does not count as program time. On a real board, pausing sets the motor driver's speed pins to 0 through the safety layer and Continue or Step restores them, so a paused robot does not keep driving.

**8d "Why isn't it working?"** (Problems and Debugger tabs): the learner picks what is wrong (an LED, a button, a motor, the upload, something else). Causes the app found evidence for (the circuit check, pin conflicts, a pin wired but never used, a button read only once outside a loop, E-STOP on, a low motor speed limit, a motor speed too small to start, no port, the last upload's error) come first, marked "Found"; the rest are marked "Could be" with how to check them. It never claims to know what is wrong on a real breadboard.

**Evidence.** Unit tests: `extensions/test/pins.test.ts` (4), `core/test/check.test.ts` (9), `extensions/test/debug-example.test.ts` (2), `core/test/schematic.test.ts` (3), `extensions/test/debugger.test.ts` (3), `extensions/test/diagnose.test.ts` (5). End-to-end: `CHECK: the wrongly wired example is flagged…`, `SIM: the circuit diagram…`, `DEBUG: a breakpoint stops Blink on the simulator…`, `DEBUG: pausing a program on a real board stops the motors…` (pretend Firmata board). Screenshots: `REA_SCREENSHOTS/P8_circuit_check.png`, `P8_schematic.png`, `P8_schematic_mistakes.png`, `P8_debugger.png`, `P8_diagnosis.png`.

**Fixed on the way:** the dock's five tabs no longer overflow a narrow column (tabs that are not open show their icon, with the name as a tooltip).

**Not verified with real hardware:** the debugger pausing a real Tariro (checked against the pretend Firmata board), and whether the diagnosis's "could be" list matches the mistakes learners really make.

### Phase 6 record, slice 6a: Drone Studio (2026-11-18)

Done: Drone mode with drone blocks run by the live interpreter (`LiveRun` target `drone`), a Tello-compatible simulator (`DroneSim`, `DroneLink`) with flight path, altitude and the learner's limits (height ceiling, fence, battery rules, Esc to land, emergency stop), a 3D flight view and telemetry. Verified by 6 unit tests, an e2e flight and a screenshot. Next: 6b Tello link over UDP behind the same `DroneLink`; 6c missions, record and replay.

### Phase 6 record, slice 6b: Tello link (2026-11-18)

Done: a real-drone link in the main process (UDP, Tello SDK 2.0) behind the same `DroneLink` blocks use, with every command checked by `DroneGuard` (height ceiling and fence from an estimated position corrected by the drone's height and heading, battery rules, heartbeat watchdog that lands, over-height landing, emergency stop) and a safety checklist before the first real flight. Verified against a pretend Tello on localhost (unit, service and e2e tests); not yet flown with a real Tello. Next: 6c missions, record and replay.

### Phase 6 record, slice 6c: missions, record and replay (2026-11-20)

Done: every flight recorded (positions and commands, simulator or Tello), a pilot pad for flying by hand, flights saved in the project, replay in the 3D view with a timeline, and "Make blocks" to turn a recorded flight into a program (a mission) to change and fly again. Verified with unit tests (a recorded square becomes blocks that fly the same square) and an e2e test. Phase 6 exit check: simulator verified; real flight still to do with a Tello and supervision.
