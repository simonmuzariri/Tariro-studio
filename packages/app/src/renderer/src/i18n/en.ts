/** English: the source catalogue. Every other locale may translate any subset of these keys. */
export const en = {
  'common.cancel': 'Cancel',
  'file.menu': 'File',
  'file.new': 'New project',
  'file.open': 'Open…',
  'file.save': 'Save',
  'file.saveAs': 'Save as…',
  'file.export': 'Export Arduino sketch (.ino)…',
  'file.recent': 'Recent',
  'file.examples': 'Examples · {kit} kit',
  'dock.problems': 'Problems',
  'dock.problemsCount': 'Problems ({count})',
  'dock.output': 'Output',
  'dock.serial': 'Serial Monitor',
  'dock.plotter': 'Plotter',
  'dock.noProblems': 'No problems found.',
  'code.readonly': 'read-only · updates as you build',
  'code.editable': 'code mode · you are editing the C++ directly',
  'code.editAsCode': 'Edit as code…',
  'code.convert.title': 'Switch to code?',
  'code.convert.message':
    'You will edit the Arduino C++ yourself from now on. The blocks of this project are removed and cannot be brought back, so save a copy first if you want to keep them.',
  'code.convert.confirm': 'Switch to code',
  'plot.empty': 'Connect the Serial Monitor and print numbers, for example "25" or "temp:25, light:60", to see them plotted.',
  'plot.clear': 'Clear',
} as const;

export type MessageKey = keyof typeof en;
