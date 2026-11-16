import { SerialPort, SerialPortMock } from 'serialport';
import { SimulatedFirmataBoard } from '@tariro-studio/core';
import type { PortBackend, PortHandle } from './serial.js';

const openWith =
  (Ctor: typeof SerialPort | typeof SerialPortMock) =>
  (path: string, baudRate: number): Promise<PortHandle> =>
    new Promise((resolve, reject) => {
      const port = new Ctor({ path, baudRate, autoOpen: false });
      port.open((err) => (err ? reject(err) : resolve(port as unknown as PortHandle)));
    });

export const realBackend: PortBackend = {
  list: () => SerialPort.list(),
  open: openWith(SerialPort),
};

/**
 * Development/test only (TARIRO_SERIAL_MOCK, never in packaged builds): one virtual Tariro on
 * /dev/ttyMOCK0. `echo` returns what is written to it, so e2e tests can exercise the port
 * picker, upload flow and Serial Monitor without hardware. `firmata` is a simulated board
 * running StandardFirmata for live mode; `onPinWrite` reports what its pins were told to do.
 */
export function mockBackend(kind: 'echo' | 'firmata' = 'echo', onPinWrite?: (write: string) => void): PortBackend {
  // Use serialport's own mock binding instance (a separately bundled copy would not share ports).
  const MockBinding = SerialPortMock.binding;
  MockBinding.reset();
  MockBinding.createPort('/dev/ttyMOCK0', {
    echo: kind === 'echo',
    record: true,
    vendorId: '1a86',
    productId: '7523',
    manufacturer: 'wch.cn (mock)',
  });
  return {
    list: () => MockBinding.list(),
    open: kind === 'firmata' ? async () => simulatedFirmataPort(onPinWrite) : openWith(SerialPortMock),
  };
}

function simulatedFirmataPort(onPinWrite?: (write: string) => void): PortHandle {
  let onData: (chunk: Buffer) => void = () => {};
  let onClose: () => void = () => {};
  const sim = new SimulatedFirmataBoard((bytes) => setTimeout(() => handle.isOpen && onData(Buffer.from(bytes)), 1));
  // A learner-visible input so "read pin" blocks have something to show: A0 reads mid-scale.
  sim.setAnalog(0, 512);
  let reported = 0;
  const handle: PortHandle = {
    isOpen: true,
    on(event: string, cb: (arg: never) => void) {
      if (event === 'data') onData = cb as unknown as (chunk: Buffer) => void;
      if (event === 'close') onClose = cb as unknown as () => void;
      return handle;
    },
    write(data, cb) {
      sim.receive(typeof data === 'string' ? Buffer.from(data) : data);
      for (; reported < sim.writes.length; reported++) onPinWrite?.(sim.writes[reported]!);
      cb?.(null);
      return true;
    },
    close(cb) {
      handle.isOpen = false;
      cb?.();
      onClose();
    },
  };
  // A real board announces itself after the reset that opening the port causes.
  setTimeout(() => sim.powerUp(), 50);
  return handle;
}
