import { useEffect, useRef, useState } from 'react';
import { Eraser, Plug, SendHorizontal, Unplug } from 'lucide-react';
import { BAUD_RATES, type SerialState } from '@tariro-studio/core';

interface Props {
  port: string;
  state: SerialState;
  text: string;
  defaultBaud: number;
  onOpen(path: string, baud: number): void;
  onClose(): void;
  onSend(data: string): void;
  onClear(): void;
}

const ENDINGS = { none: '', lf: '\n', crlf: '\r\n' } as const;

export function SerialMonitor({ port, state, text, defaultBaud, onOpen, onClose, onSend, onClear }: Props) {
  const [baud, setBaud] = useState(defaultBaud);
  const [line, setLine] = useState('');
  const [ending, setEnding] = useState<keyof typeof ENDINGS>('lf');
  const [follow, setFollow] = useState(true);
  const out = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (follow && out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [text, follow]);

  const connected = state.open && state.path === port;
  const send = () => {
    if (!line) return;
    onSend(line + ENDINGS[ending]);
    setLine('');
  };

  return (
    <div className="serial-monitor">
      <div className="toolbar-row">
        <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} disabled={connected} aria-label="Baud rate" data-testid="baud-select">
          {BAUD_RATES.map((b) => (
            <option key={b} value={b}>
              {b} baud
            </option>
          ))}
        </select>
        {connected ? (
          <button type="button" className="btn small" onClick={onClose} data-testid="serial-toggle">
            <Unplug className="icon sm" />
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn small solid" onClick={() => onOpen(port, baud)} disabled={!port} data-testid="serial-toggle">
            <Plug className="icon sm" />
            Connect
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> auto-scroll
        </label>
        <button type="button" className="btn ghost small" onClick={onClear} data-tip="Clear the received text">
          <Eraser className="icon sm" />
          Clear
        </button>
        <span className={`serial-state ${state.error ? 'bad' : connected ? 'on' : ''}`} data-testid="serial-state">
          <i className="dot" aria-hidden="true" />
          <span>{state.error ? state.error : connected ? `Connected to ${state.path} at ${state.baud}` : port ? 'Not connected' : 'Connect a board first'}</span>
        </span>
      </div>
      <pre ref={out} className="serial-output" data-testid="serial-output">
        {text}
      </pre>
      <form
        className="serial-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={line} onChange={(e) => setLine(e.target.value)} placeholder={connected ? 'Type and press Enter to send' : ''} disabled={!connected} aria-label="Text to send" data-testid="serial-input" />
        <select value={ending} onChange={(e) => setEnding(e.target.value as keyof typeof ENDINGS)} aria-label="Line ending">
          <option value="none">no line ending</option>
          <option value="lf">newline</option>
          <option value="crlf">CR + newline</option>
        </select>
        <button type="submit" className="btn small" disabled={!connected || !line}>
          <SendHorizontal className="icon sm" />
          Send
        </button>
      </form>
    </div>
  );
}
