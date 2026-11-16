import { describe, expect, it } from 'vitest';
import { channels, dispatch, IpcValidationError, ipcContract, type HandlerMap } from '../src/ipc.js';

const info = {
  name: 'Tariro Studio',
  version: '0.1.0',
  platform: 'linux' as const,
  arch: 'x64',
  versions: { electron: '44.10.1', chrome: '1', node: '24' },
};

const handlers: HandlerMap = {
  'app:version': () => '0.1.0',
  'app:info': () => info,
};

describe('ipc contract', () => {
  it('lists every channel exactly once', () => {
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels.sort()).toEqual(Object.keys(ipcContract).sort());
  });

  it('dispatches a valid call and returns the validated result', async () => {
    await expect(dispatch('app:version', handlers['app:version'], [])).resolves.toBe('0.1.0');
    await expect(dispatch('app:info', handlers['app:info'], [])).resolves.toEqual(info);
  });

  it('rejects unexpected arguments before running the handler', async () => {
    let ran = false;
    const spy = () => {
      ran = true;
      return '0.1.0';
    };
    await expect(dispatch('app:version', spy, ['extra'])).rejects.toBeInstanceOf(IpcValidationError);
    expect(ran).toBe(false);
  });

  it('rejects a handler result that breaks the contract', async () => {
    const bad = (() => ({ ...info, platform: 'plan9' })) as unknown as HandlerMap['app:info'];
    const err = await dispatch('app:info', bad, []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IpcValidationError);
    expect((err as IpcValidationError).direction).toBe('result');
  });

  it('rejects an empty version string', async () => {
    await expect(dispatch('app:version', () => '', [])).rejects.toBeInstanceOf(IpcValidationError);
  });
});
