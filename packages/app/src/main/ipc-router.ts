import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { channels, dispatch, type Channel, type HandlerMap } from '@tariro-studio/core';

/**
 * Registers one ipcMain.handle per contract channel. `HandlerMap` makes a missing handler a
 * compile error; `isTrustedSender` rejects calls from any frame that is not our own UI.
 */
export function registerIpc(handlers: HandlerMap, isTrustedSender: (url: string) => boolean): () => void {
  for (const channel of channels) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const url = event.senderFrame?.url ?? '';
      if (!isTrustedSender(url)) throw new Error(`Rejected IPC "${channel}" from untrusted frame`);
      return dispatch(channel as Channel, handlers[channel as Channel] as never, args);
    });
  }
  return () => channels.forEach((c) => ipcMain.removeHandler(c));
}
