/**
 * Tariro Studio's own icon set: filled, two-tone, rounded shapes on a 24-unit grid. The main
 * shape uses the text colour; the second tone is the same colour at 35 % (class "d2"), so every
 * icon works on light, dark and coloured grounds. Small interface glyphs (close, chevrons, check)
 * are bold rounded strokes. Drawn for Tariro Studio; no third-party icon artwork.
 */
import type { ComponentType, ReactNode, SVGProps } from 'react';

export type IconType = ComponentType<SVGProps<SVGSVGElement>>;

function icon(name: string, body: ReactNode, stroke = false): IconType {
  const C = ({ className, ...rest }: SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill={stroke ? 'none' : 'currentColor'}
      stroke={stroke ? 'currentColor' : 'none'}
      strokeWidth={stroke ? 2.6 : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`ti ti-${name}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {body}
    </svg>
  );
  C.displayName = name;
  return C;
}

const D2 = 'd2'; // second tone

// ───────── glyphs (strokes) ─────────
export const X = icon('x', <path d="M6 6l12 12M18 6L6 18" />, true);
export const Minus = icon('minus', <path d="M5 12h14" />, true);
export const Plus = icon('plus', <path d="M12 5v14M5 12h14" />, true);
export const Check = icon('check', <path d="M5 12.5l4.5 4.5L19 7.5" />, true);
export const ChevronDown = icon('chevron-down', <path d="M6.5 9.5L12 15l5.5-5.5" />, true);
export const Menu = icon('menu', <path d="M4 7h16M4 12h16M4 17h16" />, true);
export const ArrowLeftRight = icon('arrow-left-right', <path d="M8 4L4 8l4 4M4 8h15M16 12l4 4-4 4M20 16H5" />, true);
export const Square = icon('square', <rect x="5" y="5" width="14" height="14" rx="2" />, true);
export const Copy = icon('copy', <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 011-1h9" /></>, true);
export const LoaderCircle = icon('loader', <path d="M12 3a9 9 0 109 9" />, true);
export const Loader2 = LoaderCircle;
export const Undo2 = icon('undo', <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />, true);
export const Redo2 = icon('redo', <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />, true);
export const RotateCcw = icon('rotate', <path d="M4 4v6h6M5 15a8 8 0 102-8.3L4 10" />, true);
export const ZoomIn = icon('zoom-in', <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6" /></>, true);
export const ZoomOut = icon('zoom-out', <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8M7.5 10.5h6" /></>, true);
export const Search = icon('search', <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" /></>, true);
export const ChartLine = icon('chart', <path d="M4 4v16h16M7 15l4-5 3 3 5-6" />, true);
export const Activity = icon('activity', <path d="M3 12h4l3-8 4 16 3-8h4" />, true);
export const Waves = icon('waves', <path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 16c3-3 6 3 9 0s6 3 9 0" />, true);
export const SendHorizontal = icon('send', <path d="M4 12h12M11 6l6 6-6 6M20 5v14" />, true);
export const Crosshair = icon('crosshair', <><circle cx="12" cy="12" r="7.5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>, true);
export const LocateFixed = icon('locate', <><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>, true);

// ───────── status ─────────
export const CircleCheck = icon('circle-check', <><circle className={D2} cx="12" cy="12" r="10" /><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></>);
export const CircleX = icon('circle-x', <><circle className={D2} cx="12" cy="12" r="10" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></>);
export const CircleAlert = icon('circle-alert', <><circle className={D2} cx="12" cy="12" r="10" /><rect x="10.7" y="6.5" width="2.6" height="7.5" rx="1.3" /><circle cx="12" cy="17" r="1.5" /></>);
export const Info = icon('info', <><circle className={D2} cx="12" cy="12" r="10" /><rect x="10.7" y="10" width="2.6" height="7.5" rx="1.3" /><circle cx="12" cy="7" r="1.5" /></>);
export const CircleHelp = icon('help', <><circle className={D2} cx="12" cy="12" r="10" /><path d="M9.3 9.2a2.8 2.8 0 015.4 1c0 2-2.7 2.3-2.7 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><circle cx="12" cy="17.6" r="1.4" /></>);
export const TriangleAlert = icon('triangle-alert', <><path className={D2} d="M10.3 3.6a2 2 0 013.4 0l8 14A2 2 0 0120 20.6H4a2 2 0 01-1.7-3z" /><rect x="10.8" y="8.5" width="2.4" height="6.5" rx="1.2" /><circle cx="12" cy="17.4" r="1.4" /></>);
export const Octagon = icon('octagon', <path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z" />);

// ───────── run and build ─────────
export const Play = icon('play', <path d="M7 4.5a1.5 1.5 0 012.3-1.3l11 7.5a1.5 1.5 0 010 2.6l-11 7.5A1.5 1.5 0 017 19.5z" />);
export const Pause = icon('pause', <><rect x="5.5" y="4" width="4.5" height="16" rx="1.5" /><rect x="14" y="4" width="4.5" height="16" rx="1.5" /></>);
export const Flag = icon('flag', <><path className={D2} d="M6 4h11.5a1 1 0 01.8 1.6L16 9l2.3 3.4a1 1 0 01-.8 1.6H6z" /><rect x="4" y="2.5" width="2.6" height="19" rx="1.3" /></>);
export const Zap = icon('zap', <path d="M13.5 2L4.5 13.5h6.5L9.5 22l10-12.5H13z" />);
export const Upload = icon('upload', <><rect className={D2} x="3" y="14" width="18" height="7" rx="2" /><path d="M12 2.5l5.5 5.5h-3.6v7.5h-3.8V8H6.5z" /></>);
export const Download = icon('download', <><rect className={D2} x="3" y="14" width="18" height="7" rx="2" /><path d="M12 17.5L6.5 12h3.6V3.5h3.8V12h3.6z" /></>);
export const Gauge = icon('gauge', <><path className={D2} d="M12 3a10 10 0 00-8.7 15h17.4A10 10 0 0012 3z" /><path d="M11 13.5l5.5-6 .8.7-4.6 6.6a1.6 1.6 0 11-1.7-1.3z" /></>);

// ───────── files ─────────
export const FilePlus = icon('file-plus', <><path className={D2} d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" /><path d="M14 2l6 6h-4.5A1.5 1.5 0 0114 6.5z" /><path d="M12 11v7M8.5 14.5h7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></>);
export const FolderOpen = icon('folder-open', <><path className={D2} d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v2H3z" /><path d="M2.4 10.8A1.5 1.5 0 013.8 9h17.4a1.5 1.5 0 011.4 1.9l-2.2 8A2 2 0 0118.5 20h-13a2 2 0 01-1.9-1.4z" /></>);
export const FolderClock = icon('folder-clock', <><path className={D2} d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><circle cx="15.5" cy="14" r="5" /><path d="M15.5 11.5V14l1.6 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>);
export const Save = icon('save', <><path className={D2} d="M5 3h11l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /><rect x="7" y="3" width="8" height="5.5" rx="1" /><rect x="6.5" y="13" width="11" height="8" rx="1.5" /></>);
export const SaveAll = icon('save-all', <><path className={D2} d="M3 7a2 2 0 012-2v14h12a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M8 2h9l4 4v9a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2z" /></>);
export const FileOutput = icon('file-output', <><path className={D2} d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" /><path d="M8 13h6.5l-2-2 1.4-1.4 4.4 4.4-4.4 4.4-1.4-1.4 2-2H8z" /></>);
export const FileCode2 = icon('file-code', <><path className={D2} d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" /><path d="M10 11.5L7.5 14l2.5 2.5M14 11.5l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></>);
export const ScrollText = icon('scroll', <><rect className={D2} x="4" y="3" width="16" height="18" rx="2.5" /><rect x="7.5" y="7" width="9" height="2.2" rx="1.1" /><rect x="7.5" y="11" width="9" height="2.2" rx="1.1" /><rect x="7.5" y="15" width="6" height="2.2" rx="1.1" /></>);
export const History = icon('history', <><circle className={D2} cx="12" cy="12" r="10" /><path d="M12 6.5V12l3.8 2.3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></>);
export const BookOpen = icon('book', <><path className={D2} d="M12 6.5C10 4.8 7 4 3 4v15c4 0 7 .8 9 2.5z" /><path d="M12 6.5C14 4.8 17 4 21 4v15c-4 0-7 .8-9 2.5z" /></>);
export const Lock = icon('lock', <><path className={D2} d="M7 10V7.5a5 5 0 0110 0V10h-2.6V7.5a2.4 2.4 0 00-4.8 0V10z" /><rect x="4.5" y="10" width="15" height="11" rx="2.5" /></>);
export const Pencil = icon('pencil', <><path className={D2} d="M3 21l1.2-5L15.5 4.7a2.4 2.4 0 013.4 0l.4.4a2.4 2.4 0 010 3.4L8 19.8z" /><path d="M14 6.2l3.8 3.8L8 19.8 3 21l1.2-5z" /></>);
export const PencilLine = Pencil;
export const Eraser = icon('eraser', <><path className={D2} d="M3.6 14.6l9.9-9.9a2 2 0 012.8 0l4 4a2 2 0 010 2.8l-7.6 7.6h-5z" /><path d="M3.6 14.6l5 5h4.1l2-2-6-6z" /><rect x="11" y="18.5" width="10" height="2.5" rx="1.25" /></>);
export const Trash2 = icon('trash', <><path className={D2} d="M5.5 7h13l-1 13a2 2 0 01-2 1.8h-7a2 2 0 01-2-1.8z" /><rect x="3" y="4.5" width="18" height="3" rx="1.5" /><rect x="9" y="2" width="6" height="3" rx="1.2" /><rect x="9.2" y="10" width="2" height="8" rx="1" /><rect x="12.8" y="10" width="2" height="8" rx="1" /></>);
export const ImagePlus = icon('image-plus', <><rect className={D2} x="2.5" y="4" width="16" height="15" rx="2.5" /><path d="M2.5 16l4.5-4.5 3 3 2.5-2.5 6 6v.5a.5.5 0 01-.5.5H5a2.5 2.5 0 01-2.5-2.5z" /><circle cx="7.5" cy="8.5" r="1.8" /><path d="M19.5 1.5v6M16.5 4.5h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></>);

// ───────── app ─────────
export const Puzzle = icon('puzzle', <><path className={D2} d="M4 8a2 2 0 012-2h3a2.5 2.5 0 015 0h3a2 2 0 012 2v3a2.5 2.5 0 010 5v3a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><path d="M14 6h3a2 2 0 012 2v3a2.5 2.5 0 010 5v3a2 2 0 01-2 2h-5V6.2A2.5 2.5 0 0014 6z" /></>);
export const Blocks = icon('blocks', <><path className={D2} d="M3 13h7a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><path d="M3 4a1 1 0 011-1h5l1 1.5h3L14 3h6a1 1 0 011 1v5a1 1 0 01-1 1h-6l-1 1.5h-3L9 10H4a1 1 0 01-1-1z" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>);
export const Box = icon('box', <><path className={D2} d="M12 2.5l9 4.5v10l-9 4.5-9-4.5V7z" /><path d="M12 12l9-5v10l-9 4.5zM3 7l9 5v9.5L3 17z" opacity={0.55} /><path d="M12 12v9.5" stroke="currentColor" strokeWidth="1.2" /></>);
export const Palette = icon('palette', <><path className={D2} d="M12 2.5a9.5 9.5 0 000 19c1.6 0 2.4-1 2.4-2.2 0-1.6-1.4-2-1.4-3.3 0-1 .8-1.9 2.1-1.9h2.4a4 4 0 004-4.2C21.5 5.9 17.3 2.5 12 2.5z" /><circle cx="7.5" cy="11" r="1.8" /><circle cx="10" cy="6.8" r="1.8" /><circle cx="15" cy="6.8" r="1.8" /></>);
export const Code = icon('code', <path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16" />, true);
export const Terminal = icon('terminal', <><rect className={D2} x="2" y="3.5" width="20" height="17" rx="3" /><path d="M6.5 9l3.5 3-3.5 3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><rect x="12" y="14" width="6" height="2.4" rx="1.2" /></>);
export const Cpu = icon('cpu', <><rect className={D2} x="4" y="4" width="16" height="16" rx="3" /><rect x="8" y="8" width="8" height="8" rx="1.5" /><path d="M9 1.5v3M15 1.5v3M9 19.5v3M15 19.5v3M1.5 9h3M1.5 15h3M19.5 9h3M19.5 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>);
export const CircuitBoard = icon('circuit', <><rect className={D2} x="2.5" y="2.5" width="19" height="19" rx="3" /><path d="M7 7h4v4h6M7 17h3l3-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="11" r="2" /><circle cx="7" cy="17" r="2" /></>);
export const Usb = icon('usb', <><rect className={D2} x="7" y="2" width="10" height="9" rx="1.5" /><rect x="9.2" y="4.5" width="1.8" height="2" rx=".5" /><rect x="13" y="4.5" width="1.8" height="2" rx=".5" /><path d="M5.5 11h13v4.5a6.5 6.5 0 01-13 0z" /><rect x="10.7" y="18" width="2.6" height="4.5" rx="1.3" /></>);
export const Plug = icon('plug', <><rect x="7.5" y="2" width="2.6" height="6" rx="1.3" /><rect x="13.9" y="2" width="2.6" height="6" rx="1.3" /><path d="M5 8h14v3a7 7 0 01-14 0z" /><rect className={D2} x="10.7" y="16" width="2.6" height="6" rx="1.3" /></>);
export const PlugZap = icon('plug-zap', <><path d="M5 8h14v3a7 7 0 01-14 0z" /><rect x="7.5" y="2" width="2.6" height="6" rx="1.3" /><rect x="13.9" y="2" width="2.6" height="6" rx="1.3" /><path className={D2} d="M13 13l-3 4h2.5l-1 4 3.5-5h-2.5z" /></>);
export const Unplug = icon('unplug', <><path className={D2} d="M4 4l16 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><path d="M5 8h9l5 5a7 7 0 01-14-2z" /><rect x="7.5" y="2" width="2.6" height="6" rx="1.3" /></>);
export const Languages = icon('languages', <><path className={D2} d="M3 4h10a1 1 0 011 1v7a1 1 0 01-1 1H8l-3 3v-3H3a1 1 0 01-1-1V5a1 1 0 011-1z" /><path d="M11 11h10a1 1 0 011 1v7a1 1 0 01-1 1h-2v3l-3-3h-5a1 1 0 01-1-1v-7a1 1 0 011-1z" /></>);
export const GraduationCap = icon('graduation', <><path className={D2} d="M6 11.5v4c0 1.7 2.7 3.5 6 3.5s6-1.8 6-3.5v-4l-6 3z" /><path d="M12 3.5l11 5.5-11 5.5L1 9z" /><rect x="20.2" y="9" width="1.8" height="7" rx=".9" /></>);
export const Sun = icon('sun', <><circle cx="12" cy="12" r="5" /><path className={D2} d="M12 1.5l1.8 3.2h-3.6zM12 22.5l-1.8-3.2h3.6zM1.5 12l3.2-1.8v3.6zM22.5 12l-3.2 1.8v-3.6zM4.6 4.6l3.5 1-2.5 2.5zM19.4 19.4l-3.5-1 2.5-2.5zM4.6 19.4l1-3.5 2.5 2.5zM19.4 4.6l-1 3.5-2.5-2.5z" /></>);
export const Moon = icon('moon', <><path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z" /><circle className={D2} cx="17" cy="6" r="1.5" /><circle className={D2} cx="20.5" cy="9.5" r="1" /></>);
export const Monitor = icon('monitor', <><rect className={D2} x="2" y="3" width="20" height="14" rx="2.5" /><rect x="4.5" y="5.5" width="15" height="9" rx="1" /><rect x="8" y="19" width="8" height="2.5" rx="1.25" /></>);
export const PanelLeftClose = icon('panel-left', <><rect className={D2} x="3" y="3" width="18" height="18" rx="3" /><rect x="3" y="3" width="7" height="18" rx="2" /></>);
export const PanelLeftOpen = PanelLeftClose;
export const PanelBottomClose = icon('panel-bottom', <><rect className={D2} x="3" y="3" width="18" height="18" rx="3" /><rect x="3" y="14" width="18" height="7" rx="2" /></>);
export const PanelBottomOpen = PanelBottomClose;

// ───────── toolbox categories ─────────
export const Repeat = icon('repeat', <><path d="M4 11V9a4 4 0 014-4h9V2l4.5 4.5L17 11V8H8a1 1 0 00-1 1v2z" /><path className={D2} d="M20 13v2a4 4 0 01-4 4H7v3l-4.5-4.5L7 13v3h9a1 1 0 001-1v-2z" /></>);
export const Calculator = icon('calculator', <><rect className={D2} x="4" y="2" width="16" height="20" rx="3" /><rect x="7" y="5" width="10" height="4" rx="1" /><circle cx="8.5" cy="13" r="1.4" /><circle cx="12" cy="13" r="1.4" /><circle cx="15.5" cy="13" r="1.4" /><circle cx="8.5" cy="17.2" r="1.4" /><circle cx="12" cy="17.2" r="1.4" /><circle cx="15.5" cy="17.2" r="1.4" /></>);
export const Variable = icon('variable', <><rect className={D2} x="2" y="5" width="20" height="14" rx="7" /><path d="M7.5 9l4 6M11.5 9l-4 6M14.5 9l2 3 2-3M16.5 12v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>);
export const Type = icon('type', <><rect className={D2} x="2.5" y="2.5" width="19" height="19" rx="4" /><path d="M7 6.5h10v3h-2.2V8.7h-1.5v8.1h1.6V19H9.1v-2.2h1.6V8.7H9.2v.8H7z" /></>);
export const Bot = icon('bot', <><rect x="10.8" y="1.5" width="2.4" height="4" rx="1.2" /><circle cx="12" cy="2.5" r="1.8" /><rect className={D2} x="3" y="6" width="18" height="14" rx="5" /><rect x="6" y="9" width="12" height="7" rx="3.5" /><circle cx="9.5" cy="12.5" r="1.4" fill="#fff" /><circle cx="14.5" cy="12.5" r="1.4" fill="#fff" /></>);
export const Component = icon('component', <><circle className={D2} cx="12" cy="12" r="10" /><rect x="8" y="5" width="8" height="11" rx="4" /><rect x="9" y="15.5" width="2" height="5" rx="1" /><rect x="13" y="15.5" width="2" height="6" rx="1" /></>);
export const Radar = icon('radar', <><circle className={D2} cx="12" cy="12" r="10" /><path d="M12 12L19 5.5A9.5 9.5 0 0121.5 12z" /><circle cx="12" cy="12" r="2.2" /><circle cx="8" cy="9" r="1.2" /></>);
export const Cog = icon('cog', <><path className={D2} d="M10.2 2h3.6l.6 2.8 2 .9 2.4-1.6 2.5 2.5-1.6 2.4.9 2 2.8.6v3.6l-2.8.6-.9 2 1.6 2.4-2.5 2.5-2.4-1.6-2 .9-.6 2.8h-3.6l-.6-2.8-2-.9-2.4 1.6-2.5-2.5 1.6-2.4-.9-2L2 13.8v-3.6l2.8-.6.9-2-1.6-2.4 2.5-2.5 2.4 1.6 2-.9z" /><circle cx="12" cy="12" r="4" /></>);
export const Bluetooth = icon('bluetooth', <><rect className={D2} x="4" y="1.5" width="16" height="21" rx="8" /><path d="M8 8l8 8-4 3.5v-15l4 3.5-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>);
export const Wifi = icon('wifi', <><path className={D2} d="M2 9.5a14.5 14.5 0 0120 0l-2.2 2.3a11.4 11.4 0 00-15.6 0z" /><path d="M5.6 13.2a9.3 9.3 0 0112.8 0l-2.2 2.3a6.2 6.2 0 00-8.4 0z" /><circle cx="12" cy="19" r="2.3" /></>);
export const Move = icon('move', <><circle className={D2} cx="12" cy="12" r="4.5" /><path d="M12 1.5l3.5 4h-7zM12 22.5l-3.5-4h7zM1.5 12l4-3.5v7zM22.5 12l-4 3.5v-7z" /></>);
export const Eye = icon('eye', <><path className={D2} d="M12 4.5c5.5 0 9.3 4.4 10.5 7.5-1.2 3.1-5 7.5-10.5 7.5S2.7 15.1 1.5 12C2.7 8.9 6.5 4.5 12 4.5z" /><circle cx="12" cy="12" r="4" /></>);
export const ScanEye = icon('scan-eye', <><path className={D2} d="M12 7c3.6 0 6 2.8 6.8 5-.8 2.2-3.2 5-6.8 5s-6-2.8-6.8-5C6 9.8 8.4 7 12 7z" /><circle cx="12" cy="12" r="2.4" /><path d="M2 7V4a2 2 0 012-2h3M17 2h3a2 2 0 012 2v3M22 17v3a2 2 0 01-2 2h-3M7 22H4a2 2 0 01-2-2v-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></>);
export const Music = icon('music', <><path className={D2} d="M9 6l11-3v4L9 10z" /><path d="M9 6l11-3v12.5a3 3 0 11-2.4-2.9V7.6L11.4 9.4v8.1A3 3 0 119 14.6z" /></>);
export const Volume2 = icon('volume', <><path d="M3 9h4l5-4.5v15L7 15H3z" /><path className={D2} d="M15 8.5a5 5 0 010 7l-1.4-1.4a3 3 0 000-4.2zM17.8 5.7a9 9 0 010 12.6l-1.4-1.4a7 7 0 000-9.8z" /></>);
export const VolumeX = icon('volume-x', <><path d="M3 9h4l5-4.5v15L7 15H3z" /><path className={D2} d="M15 9l6 6M21 9l-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></>);

// ───────── workbench ─────────
export const RotateCw = icon('rotate-cw', <path d="M20 4v6h-6M19 15a8 8 0 11-2-8.3l3 3.3" />, true);
export const MousePointer2 = icon('pointer', <path d="M4.5 3.5l15 6.5-6.2 2.1-2.1 6.2z" />);
export const Wand2 = icon('wand', <><rect x="2" y="13.5" width="15" height="3.4" rx="1.7" transform="rotate(-45 9.5 15.2)" /><path className={D2} d="M16 2l.9 2.1L19 5l-2.1.9L16 8l-.9-2.1L13 5l2.1-.9zM20.5 9l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /></>);
export const Cable = icon('cable', <><path d="M6 4v6a6 6 0 006 6h0a6 6 0 016 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /><rect className={D2} x="3" y="1.5" width="6" height="5" rx="1.5" /><circle cx="18" cy="21" r="2" /></>);
export const Lightbulb = icon('led', <><path className={D2} d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" /><rect x="8.5" y="18" width="7" height="2.4" rx="1.2" /><rect x="10" y="21" width="4" height="1.8" rx=".9" /></>);
export const CircleDot = icon('circle-dot', <><circle className={D2} cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4.5" /></>);
export const SquareDot = icon('square-dot', <><rect className={D2} x="3" y="3" width="18" height="18" rx="4" /><circle cx="12" cy="12" r="4" /></>);
export const ToggleLeft = icon('toggle', <><rect className={D2} x="2" y="6" width="20" height="12" rx="6" /><circle cx="8" cy="12" r="4" /></>);

// ───────── AI ─────────
export const Camera = icon('camera', <><path className={D2} d="M3 8a2 2 0 012-2h2.5l1.6-2.2A2 2 0 0110.7 3h2.6a2 2 0 011.6.8L16.5 6H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><circle cx="12" cy="12.5" r="4.2" /></>);
export const Brain = icon('brain', <><path className={D2} d="M9 3a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 001 5 3 3 0 004 3h3V3z" /><path d="M15 3a3 3 0 013 3 3 3 0 012 5 3 3 0 01-1 5 3 3 0 01-4 3h-3V3z" /></>);
