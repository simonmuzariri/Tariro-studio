/**
 * The exact toolchain versions Tariro Studio is tested with. Installers bundle the CLI and the
 * `bundled` platforms; the others are downloaded on demand at the same pinned version.
 */
export const TOOLCHAIN_PINS = {
  arduinoCli: '1.3.1',
  platforms: {
    'arduino:avr': { version: '1.8.7', name: 'Arduino AVR boards', bundled: true, sizeHint: undefined },
    // Several GB unpacked: too large for an installer, so it is installed from the app when needed.
    'esp32:esp32': { version: '3.3.10', name: 'ESP32 boards', bundled: false, sizeHint: 'about 1 GB to download' },
  } as Record<string, { version: string; name: string; bundled: boolean; sizeHint: string | undefined }>,
  /** Board-manager indexes beyond Arduino's own. */
  additionalUrls: ['https://espressif.github.io/arduino-esp32/package_esp32_index.json'],
  /** Libraries bundled besides the ones the block packs pin: live mode's firmware. */
  extraLibraries: [{ name: 'Firmata', version: '2.5.9' }],
} as const;

/** "arduino:avr" from "arduino:avr:uno:cpu=…". */
export const platformOf = (fqbn: string): string => fqbn.split(':').slice(0, 2).join(':');
