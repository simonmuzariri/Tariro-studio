import { SerialPort, SerialPortMock } from 'serialport';
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
 * Development/test only (TARIRO_SERIAL_MOCK=1, never in packaged builds): one virtual Tariro on
 * /dev/ttyMOCK0 that echoes what is written to it. Lets e2e tests exercise the port picker,
 * upload flow and Serial Monitor without hardware.
 */
export function mockBackend(): PortBackend {
  // Use serialport's own mock binding instance (a separately bundled copy would not share ports).
  const MockBinding = SerialPortMock.binding;
  MockBinding.reset();
  MockBinding.createPort('/dev/ttyMOCK0', {
    echo: true,
    record: true,
    vendorId: '1a86',
    productId: '7523',
    manufacturer: 'wch.cn (mock)',
  });
  return {
    list: () => MockBinding.list(),
    open: openWith(SerialPortMock),
  };
}
