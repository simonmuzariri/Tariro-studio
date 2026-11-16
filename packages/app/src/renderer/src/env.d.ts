import type { StudioBridge } from '@tariro-studio/core';

declare global {
  /** package.json version, injected at build time. */
  const __APP_VERSION__: string;

  interface Window {
    readonly studio: StudioBridge;
  }
}

export {};
