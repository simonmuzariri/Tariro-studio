/**
 * Builds the circuit a block program implies: an LED block on pin 13 means an LED and its
 * resistor on pin 13, a button block means a button, and so on. The Simulation Lab runs the
 * program against this circuit, and the wiring list tells the learner how to build the same
 * thing on a real breadboard.
 *
 * Only blocks that have a part model appear here. The rest of the program still runs; blocks
 * the simulator cannot run at all are reported by `checkLive(…, 'simulation')`.
 */
import { isDisabled, nodeOfPinField, pinLabel, walk, type BlockJson, type BoardDefinition, type Circuit, type LedColour, type Part, type WorkspaceJson } from '@tariro-studio/core';
import { DETECTOR_ACTIVE } from './live.js';

export interface WiringStep {
  /** The part's id in the circuit. */
  partId: string;
  title: string;
  /** How to wire it on a breadboard. */
  how: string;
}

export interface DerivedCircuit {
  circuit: Circuit;
  wiring: WiringStep[];
}

const ANALOG_SENSOR_NAMES: Record<string, string> = { POT: 'Potentiometer', LDR: 'Light sensor', SOIL: 'Soil moisture sensor', WATER: 'Water level sensor', RAIN: 'Rain sensor' };
const DETECTOR_NAMES: Record<string, string> = { IR: 'IR obstacle sensor', PIR: 'PIR motion sensor', SOUND: 'Sound sensor', RAIN: 'Rain sensor', TOUCH: 'Touch sensor', LINE: 'Line sensor' };

export function deriveCircuit(workspace: WorkspaceJson, board: BoardDefinition): DerivedCircuit {
  const parts = new Map<string, Part>();
  const wiring: WiringStep[] = [];
  const add = (part: Part, title: string, how: string) => {
    if (parts.has(part.id)) return;
    parts.set(part.id, part);
    wiring.push({ partId: part.id, title, how });
  };
  const field = (b: BlockJson, name: string) => String(b.fields?.[name] ?? '');
  /** [node, label printed on the board] for a pin field, or undefined if the value is not a pin. */
  const pin = (b: BlockJson, name = 'PIN'): [string, string] | undefined => {
    const node = nodeOfPinField(board, field(b, name));
    return node ? [node, pinLabel(board, node)] : undefined;
  };

  const led = (p: [string, string] | undefined, colour: LedColour, name = `${colour[0]!.toUpperCase()}${colour.slice(1)} LED`) => {
    if (!p) return;
    const [node, label] = p;
    const id = `led:${node}`;
    if (parts.has(id)) return;
    const builtin = board.pins.builtinLed !== undefined && node === `D${board.pins.builtinLed}`;
    const mid = `${id}:mid`;
    parts.set(`${id}:r`, { kind: 'resistor', id: `${id}:r`, label: `220 Ω resistor for the LED on pin ${label}`, a: node, b: mid, ohms: 220 });
    add(
      { kind: 'led', id, label: `${name} on pin ${label}`, anode: mid, cathode: 'GND', colour },
      `${name} on pin ${label}`,
      `Pin ${label} → 220 Ω resistor → long leg of the LED. Short leg → GND.${builtin ? ` The board's built-in LED is on this pin too.` : ''}`,
    );
  };

  const tops = (workspace.blocks?.blocks ?? []).filter((b) => !isDisabled(b));
  for (const b of walk(tops)) {
    if (isDisabled(b)) continue;
    switch (b.type) {
      case 'basic_led':
      case 'basic_led_brightness':
      case 'io_digital_write':
      case 'io_pwm_write':
        led(pin(b), 'red');
        break;
      case 'act_traffic_light':
        led(pin(b, 'RED'), 'red');
        led(pin(b, 'YELLOW'), 'yellow');
        led(pin(b, 'GREEN'), 'green');
        break;
      case 'act_rgb_led':
        led(pin(b, 'R'), 'red', 'RGB LED red leg');
        led(pin(b, 'G'), 'green', 'RGB LED green leg');
        led(pin(b, 'B'), 'blue', 'RGB LED blue leg');
        break;
      case 'basic_buzzer': {
        const p = pin(b);
        if (p) add({ kind: 'buzzer', id: `buzzer:${p[0]}`, label: `Buzzer on pin ${p[1]}`, pos: p[0], neg: 'GND' }, `Buzzer on pin ${p[1]}`, `Pin ${p[1]} → buzzer + leg. Buzzer − leg → GND.`);
        break;
      }
      case 'sensor_button_pressed': {
        const p = pin(b);
        if (p) add({ kind: 'button', id: `button:${p[0]}`, label: `Button on pin ${p[1]}`, a: p[0], b: 'GND' }, `Button on pin ${p[1]}`, `One side of the button → pin ${p[1]}. Other side → GND. No resistor needed: the block switches on the pin's pull-up.`);
        break;
      }
      case 'basic_switch': {
        const p = pin(b);
        if (p) add({ kind: 'switch', id: `switch:${p[0]}`, label: `Switch on pin ${p[1]}`, a: p[0], b: 'GND' }, `Switch on pin ${p[1]}`, `Middle leg of the switch → pin ${p[1]}. One outer leg → GND.`);
        break;
      }
      case 'io_digital_read': {
        const p = pin(b);
        if (!p) break;
        if (field(b, 'PULL') === 'INPUT_PULLUP')
          add({ kind: 'button', id: `button:${p[0]}`, label: `Button on pin ${p[1]}`, a: p[0], b: 'GND' }, `Button on pin ${p[1]}`, `One side of the button → pin ${p[1]}. Other side → GND.`);
        else {
          parts.set(`pulldown:${p[0]}`, { kind: 'resistor', id: `pulldown:${p[0]}`, label: `10 kΩ pull-down on pin ${p[1]}`, a: p[0], b: 'GND', ohms: 10_000 });
          add({ kind: 'button', id: `button:${p[0]}`, label: `Button on pin ${p[1]}`, a: '5V', b: p[0] }, `Button on pin ${p[1]}`, `One side of the button → 5V. Other side → pin ${p[1]}, and a 10 kΩ resistor from pin ${p[1]} to GND so the pin reads LOW when the button is up.`);
        }
        break;
      }
      case 'sensor_analog_level':
      case 'io_analog_read':
      case 'enc_absolute_analog': {
        const p = pin(b);
        if (!p) break;
        const name = b.type === 'sensor_analog_level' ? (ANALOG_SENSOR_NAMES[field(b, 'SENSOR')] ?? 'Sensor') : b.type === 'enc_absolute_analog' ? 'Absolute encoder' : 'Potentiometer';
        add(
          { kind: 'potentiometer', id: `pot:${p[0]}`, label: `${name} on pin ${p[1]}`, high: '5V', wiper: p[0], low: 'GND', ohms: 10_000 },
          `${name} on pin ${p[1]}`,
          name === 'Potentiometer' ? `Outer legs → 5V and GND. Middle leg → pin ${p[1]}.` : `Module VCC → 5V, GND → GND, signal (A0 or OUT) → pin ${p[1]}. In the simulator a slider stands in for what the sensor measures.`,
        );
        break;
      }
      case 'sensor_detect': {
        const p = pin(b);
        if (!p) break;
        const kind = field(b, 'SENSOR');
        const name = DETECTOR_NAMES[kind] ?? 'Sensor';
        add({ kind: 'signal', id: `signal:${p[0]}`, label: `${name} on pin ${p[1]}`, output: p[0], activeHigh: (DETECTOR_ACTIVE[kind] ?? 'HIGH') === 'HIGH' }, `${name} on pin ${p[1]}`, `Module VCC → 5V, GND → GND, OUT → pin ${p[1]}.`);
        break;
      }
      case 'act_relay': {
        const p = pin(b);
        if (p) add({ kind: 'logic-load', id: `relay:${p[0]}`, label: `Relay on pin ${p[1]}`, input: p[0], activeHigh: field(b, 'ACTIVE') === 'HIGH' }, `Relay module on pin ${p[1]}`, `Module VCC → 5V, GND → GND, IN → pin ${p[1]}.`);
        break;
      }
      case 'tariro_motor_run':
      case 'tariro_motor_stop':
      case 'tariro_drive': {
        const pins = board.onboard?.find((o) => o.kind === 'dual-motor-driver')?.pins;
        if (!pins || pins['INA'] === undefined) break;
        for (const m of ['A', 'B'] as const)
          add(
            { kind: 'motor', id: `motor:${m}`, label: `Motor ${m} (${m === 'A' ? 'left' : 'right'})`, direction: `D${pins[`IN${m}`]}`, speed: `D${pins[`EN${m}`]}` },
            `Motor ${m} (${m === 'A' ? 'left' : 'right'})`,
            `Plug the motor into the board's motor ${m} socket. The board drives it from pins ${pins[`IN${m}`]} (direction) and ${pins[`EN${m}`]} (speed).`,
          );
        break;
      }
    }
  }
  return { circuit: { parts: [...parts.values()] }, wiring };
}
