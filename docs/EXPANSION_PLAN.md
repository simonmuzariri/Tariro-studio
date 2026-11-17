# Tariro Studio platform expansion: Phase 1 assessment and plan

Date: 2026-11-17. Source brief: "Master platform expansion and engineering development prompt" (Omorfo Tech Labs).
Status: **Phase 1 complete. Phase 2 slices 2a–2e built and compile-verified. Simulation Lab slices 7a–7c and 7e built on 2026-11-17: circuit solver, simulated board driven by blocks, Simulator tab, 3D workbench, and virtual instruments (multimeter, oscilloscope, logic view). Nothing new has run on real hardware. Slice 2f, the rest of Phase 7 and Phases 3–6, 8–10 not started.**

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
| 4 | Train own AI models | ⬜ | |
| 5 | Camera access with permission | ⬜ | The app currently denies every permission request |
| 6 | Computer vision in block programs | ⬜ | |
| 7 | AI predictions control hardware safely | ⬜ | No safety layer yet; live mode has Stop, which switches pins off |
| 8 | Small autonomous cars | ⬜ | |
| 9 | Drones with blocks | ⬜ | |
| 10 | 3D circuits in the Simulation Lab | 🟡 | 3D workbench: breadboard, generic microcontroller board, LEDs, resistors, buttons, slide switches, potentiometers and buzzers; place, drag, turn, remove; wires by clicking two points or from a pin picker; orbit, pan, zoom. **Not yet**: sensors, motors, servos and other boards as 3D parts; photographic detail |
| 11 | Connect virtual components and simulate | ✅ | Breadboard connectivity rules (column strips, the centre gap, rails, wires, board pins) decide which nodes parts are on; the solver and the block program then drive them. Mistakes are explained: 5V wired to GND, two pins wired together, a part with all legs in one strip, two parts in one hole |
| 12 | Virtual instruments | ✅ | Multimeter (DC volts between two probes while running; ohms with the power off, LEDs reading open as on a real meter; amps through a chosen part), two-channel oscilloscope with time base, hold, min/max/average, frequency and duty, and a logic view of every pin in use. Probes placed by clicking holes, rails or pins in 3D, or from lists. PWM shows as its average voltage (stated in the panel) |
| 13 | Simulate microcontrollers and robots | 🟡 | Block programs run on a simulated 5 V AVR board through the same interpreter as live mode; the Tariro motors are simulated as driver channels. No servo, encoder, robot body or ESP32/Pico model; typed C++ is not simulated (7h) |
| 14 | Simulation to hardware | 🟡 | The Simulator tab lists how to wire the same parts on a breadboard, and the same project uploads to the real board. Not yet compared side by side on hardware |
| 15 | Debug programs and hardware | 🟡 | Compiler errors map to blocks; live mode highlights the running block; no stepping or watches |
| 16 | One project system | 🟡 | The workbench is saved in the same `.tsp` project file as the blocks (an optional `circuit` section; older files still open). Only the blocks and workbench environments exist so far |
| 17 | Existing functionality still works | ✅ | 267 unit + 40 end-to-end tests pass on 2026-11-17 |

### Known issues carried into the expansion
- The Tariro board did not answer uploads on 2026-11-17 (the toolchain fails the same way outside the app); it worked on 2026-11-16. Hardware to be checked.
- Whole numbers print as "1.00" from block programs.
- Installers are not built; Windows and macOS are untested.
- MicroPython and live mode cover only part of the block set.

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
