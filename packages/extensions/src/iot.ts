/**
 * Wi-Fi for ESP32 boards (IoT kit): connect, status, IP address and a simple HTTP GET.
 * The network name and password are stored in the project file in plain text.
 */
import { ORDER, type Emitter, type ExtensionManifest } from '@tariro-studio/core';
import { include, serialBegin, STATEMENT, txt, valueIn } from './util.js';
import { iotMicroPython } from './micropython.js';

const STYLE = 'iot_blocks';

const blocks: ExtensionManifest['blocks'] = [
  {
    type: 'wifi_connect',
    json: {
      type: 'wifi_connect',
      message0: 'connect to Wi-Fi %1 password %2',
      args0: [valueIn('SSID', 'String'), valueIn('PASSWORD', 'String')],
      ...STATEMENT,
      style: STYLE,
      tooltip: 'Joins a Wi-Fi network, waiting up to 15 seconds. The password is saved in the project file.',
    },
  },
  {
    type: 'wifi_connected',
    json: { type: 'wifi_connected', message0: 'Wi-Fi connected?', output: 'Boolean', style: STYLE },
  },
  {
    type: 'wifi_ip',
    json: { type: 'wifi_ip', message0: 'my IP address', output: 'String', style: STYLE },
  },
  {
    type: 'http_get',
    json: {
      type: 'http_get',
      message0: 'text from web address %1',
      args0: [valueIn('URL', 'String')],
      output: 'String',
      style: STYLE,
      tooltip: 'Downloads a web page or API answer as text (empty if it fails). Use http:// addresses.',
    },
  },
];

const emitters: Record<string, Emitter> = {
  wifi_connect: {
    kind: 'statement',
    emit: (ctx) => {
      include(ctx, 'WiFi.h');
      serialBegin(ctx);
      ctx.contribute({
        section: 'functions',
        key: 'iot:wifi',
        priority: 20,
        code: [
          '// Join a Wi-Fi network, giving up after 15 s so the rest of the program still runs.',
          'bool tariroWifiConnect(String ssid, String password) {',
          '  WiFi.mode(WIFI_STA);',
          '  WiFi.begin(ssid.c_str(), password.c_str());',
          '  unsigned long start = millis();',
          '  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000UL) delay(250);',
          '  Serial.println(WiFi.status() == WL_CONNECTED ? "Wi-Fi connected: " + WiFi.localIP().toString() : String("Wi-Fi not connected"));',
          '  return WiFi.status() == WL_CONNECTED;',
          '}',
        ].join('\n'),
      });
      return `tariroWifiConnect(${ctx.value('SSID', ORDER.COMMA, '""')}, ${ctx.value('PASSWORD', ORDER.COMMA, '""')});`;
    },
  },
  wifi_connected: {
    kind: 'value',
    type: 'boolean',
    emit: (ctx) => {
      include(ctx, 'WiFi.h');
      return ['WiFi.status() == WL_CONNECTED', ORDER.EQUALITY];
    },
  },
  wifi_ip: {
    kind: 'value',
    type: 'string',
    emit: (ctx) => {
      include(ctx, 'WiFi.h');
      return ['WiFi.localIP().toString()', ORDER.POSTFIX];
    },
  },
  http_get: {
    kind: 'value',
    type: 'string',
    emit: (ctx) => {
      include(ctx, 'WiFi.h');
      include(ctx, 'HTTPClient.h');
      ctx.contribute({
        section: 'functions',
        key: 'iot:http',
        priority: 20,
        code: [
          '// HTTP GET; returns the body, or an empty text if Wi-Fi is down or the request fails.',
          'String tariroHttpGet(String url) {',
          '  if (WiFi.status() != WL_CONNECTED) return "";',
          '  HTTPClient http;',
          '  http.begin(url);',
          '  int code = http.GET();',
          `  String body = code == 200 ? http.getString() : String("");`,
          '  http.end();',
          '  return body;',
          '}',
        ].join('\n'),
      });
      return [`tariroHttpGet(${ctx.value('URL', ORDER.NONE, '""')})`, ORDER.ATOMIC];
    },
  },
};

export const iotExtension: ExtensionManifest = {
  id: 'iot',
  name: 'Wi-Fi & Internet',
  version: '0.1.0',
  category: 'iot',
  kits: ['IoT'],
  description: 'Connect an ESP32 board to Wi-Fi and fetch data from the web.',
  boards: ['malkon-esp32s3'],
  blocks,
  emitters: { arduino: emitters, micropython: iotMicroPython },
  toolbox: [
    {
      id: 'iot',
      name: 'Wi-Fi',
      style: 'iot_category',
      contents: [
        { kind: 'block', type: 'wifi_connect', inputs: { SSID: txt('SchoolWiFi'), PASSWORD: txt('password') } },
        { kind: 'block', type: 'wifi_connected' },
        { kind: 'block', type: 'wifi_ip' },
        { kind: 'block', type: 'http_get', inputs: { URL: txt('http://example.com/') } },
      ],
    },
  ],
};

