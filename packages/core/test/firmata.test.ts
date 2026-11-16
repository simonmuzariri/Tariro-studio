import { describe, expect, it } from 'vitest';
import { FirmataBoard, FirmataParser, FIRMATA, SimulatedFirmataBoard } from '../src/index.js';

const timing = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now: () => Date.now(), replyMs: 200 };

/** A FirmataBoard wired to a simulated Uno, with every byte sent to the board recorded. */
function connect() {
  const sent: number[] = [];
  const sim: SimulatedFirmataBoard = new SimulatedFirmataBoard((bytes) => queueMicrotask(() => board.receive(bytes)));
  const board: FirmataBoard = new FirmataBoard((bytes) => {
    sent.push(...bytes);
    sim.receive(bytes);
  }, timing);
  return { sim, board, sent };
}

describe('FirmataParser', () => {
  it('reads version, firmware name, analog and digital messages across chunk boundaries', () => {
    const p = new FirmataParser();
    const name = [...'Std'].flatMap((c) => [c.charCodeAt(0), 0]);
    const bytes = [0xf9, 2, 5, 0xf0, 0x79, 2, 5, ...name, 0xf7, 0xe3, 0x7f, 0x07, 0x91, 0x05, 0x01];
    const out = [...p.push(bytes.slice(0, 7)), ...p.push(bytes.slice(7))];
    expect(out).toEqual([
      { type: 'version', major: 2, minor: 5 },
      { type: 'firmware', major: 2, minor: 5, name: 'Std' },
      { type: 'analog', channel: 3, value: 1023 },
      { type: 'digital', port: 1, mask: 0x85 },
    ]);
  });

  it('skips stray data bytes and unknown sysex', () => {
    const p = new FirmataParser();
    expect(p.push([0x12, 0x34, 0xf0, 0x55, 1, 2, 0xf7, 0xe0, 1, 0])).toEqual([{ type: 'analog', channel: 0, value: 1 }]);
  });
});

describe('FirmataBoard', () => {
  it('handshakes: firmware name and analog pin mapping', async () => {
    const { board, sim } = connect();
    sim.powerUp(); // a real board announces itself after the reset that opening the port causes
    expect(await board.handshake(1000)).toEqual({ name: 'StandardFirmata.ino', version: '2.5' });
    expect(await board.analogPin(0)).toBe(14);
    expect(await board.analogPin(9)).toBeUndefined();
  });

  it('asks again when the announcement was missed', async () => {
    const { board } = connect();
    expect((await board.handshake(1500))?.name).toBe('StandardFirmata.ino');
  });

  it('reports no firmware when the board stays silent', async () => {
    const board = new FirmataBoard(() => {}, timing);
    expect(await board.handshake(60)).toBeUndefined();
  });

  it('sets the pin mode once and writes digital values', async () => {
    const { board, sim, sent } = connect();
    await board.digitalWrite(13, true);
    await board.digitalWrite(13, false);
    expect(sent).toEqual([FIRMATA.SET_PIN_MODE, 13, 1, FIRMATA.SET_DIGITAL_PIN_VALUE, 13, 1, FIRMATA.SET_DIGITAL_PIN_VALUE, 13, 0]);
    expect(sim.writes).toEqual(['13=1', '13=0']);
  });

  it('writes PWM (clamped to 0–255) and servo angles', async () => {
    const { board, sim } = connect();
    await board.analogWrite(5, 153);
    await board.analogWrite(5, 999);
    await board.servoWrite(9, 90);
    await board.analogWrite(18, 200); // pin ≥ 16 uses the extended message
    expect(sim.writes).toEqual(['5~153', '5~255', '9^90', '18~200']);
    expect(sim.pins.get(9)?.mode).toBe('servo');
  });

  it('reads digital inputs and follows changes', async () => {
    const { board, sim } = connect();
    expect(await board.digitalRead(2, false)).toBe(false);
    sim.setInput(2, true);
    await timing.sleep(5);
    expect(await board.digitalRead(2, false)).toBe(true);
    expect(await board.digitalRead(3, true)).toBe(true); // pull-up reads high when nothing is connected
    expect(sim.pins.get(3)?.mode).toBe('input_pullup');
  });

  it('reads analog channels', async () => {
    const { board, sim } = connect();
    sim.powerUp();
    await board.handshake(1000);
    sim.setAnalog(0, 612);
    expect(await board.analogRead(0)).toBe(612);
    expect(sim.pins.get(14)?.mode).toBe('analog');
    sim.setAnalog(0, 40);
    await timing.sleep(5);
    expect(await board.analogRead(0)).toBe(40);
    await expect(board.analogRead(9)).rejects.toThrow('A9 is not an analog pin');
  });

  it('fails with a clear message when the board stops answering', async () => {
    const board = new FirmataBoard(() => {}, { ...timing, replyMs: 30 });
    await expect(board.digitalRead(2, false)).rejects.toThrow('did not answer');
  });

  it('reset returns the board to its defaults and forgets pin modes', async () => {
    const { board, sim, sent } = connect();
    await board.digitalWrite(13, true);
    await board.reset();
    expect(sim.resets).toBe(1);
    sent.length = 0;
    await board.digitalWrite(13, true);
    expect(sent.slice(0, 3)).toEqual([FIRMATA.SET_PIN_MODE, 13, 1]);
  });
});
