import { useEffect, useRef, useState } from 'react';
import type { PortInfo } from '@tariro-studio/core';
import { Check, ChevronDown, Unplug, Usb } from '../ui/icons';

interface Props {
  ports: PortInfo[];
  /** The port in use ('' when none). */
  port: string;
  onConnect(path: string): void;
  onDisconnect(): void;
  /** While uploading or running live the port cannot change. */
  disabled?: boolean;
  /** Safety: the fastest motors may run, in percent. */
  motorLimit: number;
  onMotorLimit(percent: number): void;
}

/** The last part of a port path: "ttyACM0", "COM3", "cu.usbmodem1101". */
const shortName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * Connect: choose the USB port the board is on. Shows the port once connected; the menu also
 * offers Disconnect. Uploads, live mode, Stage mode, Python and the serial monitor all use it.
 */
export function ConnectButton({ ports, port, onConnect, onDisconnect, disabled, motorLimit, onMotorLimit }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="tb-menu connect" ref={box}>
      <button
        type="button"
        className={`btn tb-btn connect-btn${port ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? {} : { 'data-tip': port ? `Connected on ${port}. Click to change.` : 'Connect: choose the USB port your board is on' })}
        data-testid="connect-button"
      >
        {port ? <i className="connect-dot" aria-hidden="true" /> : <Usb className="icon" aria-hidden="true" />}
        <span>{port ? shortName(port) : 'Connect'}</span>
        <ChevronDown className="icon xs" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu connect-menu" role="menu" data-testid="connect-menu">
          <p className="menu-heading">{ports.length ? 'Choose the port your board is on' : 'No board found'}</p>
          {ports.length === 0 && <p className="connect-empty">Plug the board in with a USB cable. It appears here on its own.</p>}
          {ports.map((p) => (
            <button
              key={p.path}
              type="button"
              role="menuitemradio"
              aria-checked={p.path === port}
              className="menu-item"
              onClick={() => {
                onConnect(p.path);
                setOpen(false);
              }}
              data-testid={`port-${p.path}`}
            >
              <Usb className="icon" aria-hidden="true" />
              <span>{p.label}</span>
              {p.path === port && <Check className="icon sm" aria-hidden="true" />}
            </button>
          ))}
          <div className="menu-sep" />
          <label className="safety-limit" data-tip="When the computer drives the board (live, Stage mode, Python), motors never go faster than this">
            <span>
              Motor speed limit <b data-testid="motor-limit-value">{motorLimit} %</b>
            </span>
            <input type="range" min={10} max={100} step={10} value={motorLimit} onChange={(e) => onMotorLimit(Number(e.target.value))} data-testid="motor-limit" />
          </label>
          {port && (
            <>
              <div className="menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  onDisconnect();
                  setOpen(false);
                }}
                data-testid="disconnect"
              >
                <Unplug className="icon" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
