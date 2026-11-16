/**
 * One example per group of kit components (IDE_DESIGN.md M4 exit criterion: every kit component
 * has blocks, an example and a compile test). Pins follow the kit wiring guides where known.
 */
import type { ExampleProject } from './examples.js';
import { block, forever, n, program, set, t, v, wait, workspace } from './build.js';

const cmp = (op: string, a: ReturnType<typeof block>, b: ReturnType<typeof block>) => block('logic_compare', { fields: { OP: op }, inputs: { A: a, B: b } });
const and = (a: ReturnType<typeof block>, b: ReturnType<typeof block>) => block('logic_operation', { fields: { OP: 'AND' }, inputs: { A: a, B: b } });
const ifThen = (cond: ReturnType<typeof block>, then: ReturnType<typeof block>[], otherwise?: ReturnType<typeof block>[]) =>
  block('controls_if', {
    ...(otherwise ? { extraState: { hasElse: true } } : {}),
    inputs: { IF0: cond },
    do: otherwise ? { DO0: then, ELSE: otherwise } : { DO0: then },
  });
const join = (...parts: ReturnType<typeof block>[]) => block('text_join', { extraState: { itemCount: parts.length }, inputs: Object.fromEntries(parts.map((p, i) => [`ADD${i}`, p])) });
const println = (value: ReturnType<typeof block>) => block('serial_print', { fields: { MODE: 'println' }, inputs: { VALUE: value } });
const ms = (x: number) => block('tariro_wait_ms', { inputs: { MS: n(x) } });
const tone = (pin: string, hz: number, dur: number) => block('io_tone', { fields: { PIN: pin }, inputs: { FREQUENCY: n(hz), DURATION: n(dur) } });
const motor = (m: 'A' | 'B', dir: 'FORWARD' | 'BACKWARD', speed: number) => block('tariro_motor_run', { fields: { MOTOR: m, DIRECTION: dir }, inputs: { SPEED: n(speed) } });
const stopMotors = () => block('tariro_motor_stop', { fields: { MOTOR: 'BOTH' } });
const servo = (pin: string, angle: number) => block('act_servo', { fields: { PIN: pin }, inputs: { ANGLE: n(angle) } });
const light = (l: string) => block('act_traffic_light', { fields: { RED: '10', YELLOW: '11', GREEN: '12', LIGHT: l } });
const level = (sensor: string, pin: string) => block('sensor_analog_level', { fields: { SENSOR: sensor, PIN: pin } });
const detect = (sensor: string, pin: string) => block('sensor_detect', { fields: { SENSOR: sensor, PIN: pin } });

/** Starter kit: push button, traffic-light module, 7-segment display and buzzer. */
const pedestrianCrossing: ExampleProject = {
  name: 'pedestrian-crossing',
  title: 'Pedestrian crossing',
  description: 'Press the button: the light turns red and the 7-segment display counts down with beeps.',
  kit: 'Starter',
  boards: ['malkon-one', 'arduino-uno'],
  extensions: ['sensors', 'actuators'],
  workspace: workspace(
    [
      program(
        block('act_seven_segment_setup', { fields: { FIRST: '2', KIND: 'CC' } }),
        forever(
          light('GREEN'),
          ifThen(block('sensor_button_pressed', { fields: { PIN: '13' } }), [
            light('YELLOW'),
            wait(1),
            light('RED'),
            block('controls_for', {
              fields: { VAR: { id: 'count' } },
              inputs: { FROM: n(9), TO: n(0), BY: n(-1) },
              do: { DO: [block('act_seven_segment_show', { inputs: { DIGIT: v('count') } }), tone('A0', 1000, 100), wait(1)] },
            }),
            block('act_seven_segment_show', { inputs: { DIGIT: n(-1) } }),
            light('RED_YELLOW'),
            wait(1),
          ]),
        ),
      ),
    ],
    [{ id: 'count', name: 'count' }],
  ),
};

/** Starter kit: potentiometer, LDR, soil, water level, rain, IR and sound sensors. */
const sensorReport: ExampleProject = {
  name: 'sensor-report',
  title: 'Sensor report',
  description: 'Reads every Starter-kit sensor and prints the values to the Serial Monitor twice a second.',
  kit: 'Starter',
  boards: ['malkon-one', 'tariro'],
  extensions: ['sensors'],
  workspace: workspace([
    program(
      println(t('pot, light, soil, water, rain, obstacle, sound')),
      forever(
        println(
          join(
            level('POT', 'A0'), t(', '),
            level('LDR', 'A1'), t(', '),
            level('SOIL', 'A2'), t(', '),
            level('WATER', 'A3'), t(', '),
            level('RAIN', 'A4'), t(', '),
            detect('IR', '8'), t(', '),
            detect('SOUND', '12'),
          ),
        ),
        ms(500),
      ),
    ),
  ]),
};

/** Starter / IoT kits: DHT11 and the I²C LCD. */
const weatherStation: ExampleProject = {
  name: 'weather-station',
  title: 'Weather station',
  description: 'Shows temperature and humidity from a DHT11 on the 16×2 LCD.',
  kit: 'Starter',
  boards: ['malkon-one', 'malkon-esp32s3'],
  extensions: ['sensors', 'displays'],
  workspace: workspace([
    program(
      block('lcd_setup', { fields: { ADDR: '0x27' } }),
      forever(
        block('lcd_clear'),
        block('lcd_print', { fields: { ROW: '0' }, inputs: { TEXT: join(t('Temp: '), block('sensor_dht', { fields: { MODEL: 'DHT11', READING: 'TEMP', PIN: '2' } }), t(' C')), COL: n(1) } }),
        block('lcd_print', { fields: { ROW: '1' }, inputs: { TEXT: join(t('Humidity: '), block('sensor_dht', { fields: { MODEL: 'DHT11', READING: 'HUM', PIN: '2' } }), t(' %')), COL: n(1) } }),
        wait(2),
      ),
    ),
  ]),
};

/** Robotics kit: ultrasonic sensor, servo and the Tariro motors. */
const obstacleAvoider: ExampleProject = {
  name: 'obstacle-avoider',
  title: 'Obstacle-avoiding robot',
  description: 'Drives forward; when something is closer than 20 cm it stops, looks left and right with the servo, backs up and turns.',
  kit: 'Robotics',
  boards: ['tariro'],
  extensions: ['sensors', 'actuators'],
  workspace: workspace([
    program(
      servo('9', 90),
      forever(
        ifThen(
          and(
            cmp('LT', block('sensor_ultrasonic_cm', { fields: { TRIG: '12', ECHO: '13' } }), n(20)),
            cmp('GT', block('sensor_ultrasonic_cm', { fields: { TRIG: '12', ECHO: '13' } }), n(0)),
          ),
          [stopMotors(), servo('9', 20), ms(400), servo('9', 160), ms(400), servo('9', 90), motor('A', 'BACKWARD', 50), motor('B', 'BACKWARD', 50), ms(500), motor('A', 'FORWARD', 50), motor('B', 'BACKWARD', 50), ms(400)],
          [motor('A', 'FORWARD', 60), motor('B', 'FORWARD', 60)],
        ),
        ms(60),
      ),
    ),
  ]),
};

/** Robotics kit: colour sensor and servo (3D robotic arm). */
const colourSorter: ExampleProject = {
  name: 'colour-sorter',
  title: 'Colour sorter',
  description: 'The robotic arm servo points left for red objects and right for everything else.',
  kit: 'Robotics',
  boards: ['tariro', 'malkon-one'],
  extensions: ['sensors', 'actuators'],
  workspace: workspace(
    [
      program(
        block('sensor_colour_setup', { fields: { S0: '8', S1: '9', S2: '10', S3: '11', OUT: '12' } }),
        forever(
          set('red', block('sensor_colour_read', { fields: { COLOUR: 'RED' } })),
          set('green', block('sensor_colour_read', { fields: { COLOUR: 'GREEN' } })),
          set('blue', block('sensor_colour_read', { fields: { COLOUR: 'BLUE' } })),
          println(join(t('R '), v('red'), t(' G '), v('green'), t(' B '), v('blue'))),
          ifThen(and(cmp('GT', v('red'), v('green')), cmp('GT', v('red'), v('blue'))), [servo('3', 30)], [servo('3', 150)]),
          ms(300),
        ),
      ),
    ],
    [
      { id: 'red', name: 'red' },
      { id: 'green', name: 'green' },
      { id: 'blue', name: 'blue' },
    ],
  ),
};

/** Robotics kit: MPU6050, buzzer and RGB LED. */
const tiltAlarm: ExampleProject = {
  name: 'tilt-alarm',
  title: 'Tilt alarm',
  description: 'The RGB LED is green while the robot is level; tilt it and the LED turns red and the buzzer sounds.',
  kit: 'Robotics',
  boards: ['tariro', 'malkon-one'],
  extensions: ['sensors', 'actuators'],
  workspace: workspace([
    program(
      forever(
        ifThen(
          cmp('GT', block('math_single', { fields: { OP: 'ABS' }, inputs: { NUM: block('sensor_mpu6050', { fields: { READING: 'AX' } }) } }), n(0.5)),
          [block('act_rgb_led', { fields: { R: '9', G: '10', B: '11' }, inputs: { RV: n(255), GV: n(0), BV: n(0) } }), tone('A0', 1500, 200)],
          [block('act_rgb_led', { fields: { R: '9', G: '10', B: '11' }, inputs: { RV: n(0), GV: n(255), BV: n(0) } })],
        ),
        ms(100),
      ),
    ),
  ]),
};

/** Robotics kit: HM10 Bluetooth and the Tariro motors. */
const bluetoothCar: ExampleProject = {
  name: 'bluetooth-car',
  title: 'Bluetooth remote car',
  description: 'Send F, B, L, R or S from a phone Bluetooth terminal app to drive the robot.',
  kit: 'Robotics',
  boards: ['tariro'],
  extensions: ['communication'],
  workspace: workspace(
    [
      program(
        block('ble_setup', { fields: { RX: '2', TX: '3', BAUD: '9600' } }),
        block('ble_send', { fields: { MODE: 'println' }, inputs: { VALUE: t('Tariro ready: F B L R S') } }),
        forever(
          ifThen(block('ble_available'), [
            set('command', block('ble_read_line')),
            ifThen(cmp('EQ', v('command'), t('F')), [motor('A', 'FORWARD', 70), motor('B', 'FORWARD', 70)]),
            ifThen(cmp('EQ', v('command'), t('B')), [motor('A', 'BACKWARD', 70), motor('B', 'BACKWARD', 70)]),
            ifThen(cmp('EQ', v('command'), t('L')), [motor('A', 'BACKWARD', 50), motor('B', 'FORWARD', 50)]),
            ifThen(cmp('EQ', v('command'), t('R')), [motor('A', 'FORWARD', 50), motor('B', 'BACKWARD', 50)]),
            ifThen(cmp('EQ', v('command'), t('S')), [stopMotors()]),
          ]),
        ),
      ),
    ],
    [{ id: 'command', name: 'command' }],
  ),
};

/** IoT kit: soil moisture, relay + pump, PIR, buzzer and OLED. */
const smartGarden: ExampleProject = {
  name: 'smart-garden',
  title: 'Smart garden',
  description: 'Waters the plant when the soil is dry, beeps when someone walks past, and shows the soil level on the OLED.',
  kit: 'IoT',
  boards: ['malkon-esp32s3', 'malkon-one'],
  extensions: ['sensors', 'actuators', 'displays'],
  workspace: workspace(
    [
      program(
        block('oled_setup', { fields: { ADDR: '0x3C' } }),
        forever(
          set('dryness', level('SOIL', 'A0')),
          ifThen(
            cmp('GT', v('dryness'), n(60)),
            [block('act_relay', { fields: { PIN: '5', STATE: 'ON', ACTIVE: 'LOW' } })],
            [block('act_relay', { fields: { PIN: '5', STATE: 'OFF', ACTIVE: 'LOW' } })],
          ),
          ifThen(detect('PIR', '7'), [tone('6', 2000, 150)]),
          block('oled_clear'),
          block('oled_print', { fields: { SIZE: '2' }, inputs: { TEXT: t('Garden'), X: n(0), Y: n(0) } }),
          block('oled_print', { fields: { SIZE: '1' }, inputs: { TEXT: join(t('Dryness: '), v('dryness'), t(' %')), X: n(0), Y: n(28) } }),
          wait(1),
        ),
      ),
    ],
    [{ id: 'dryness', name: 'dryness' }],
  ),
};

/** IoT kit: Malkon ESP32 Wi-Fi. */
const wifiHello: ExampleProject = {
  name: 'wifi-hello',
  title: 'Wi-Fi hello',
  description: 'Connects to Wi-Fi, prints the board’s IP address and fetches a web page every 10 seconds.',
  kit: 'IoT',
  boards: ['malkon-esp32s3'],
  extensions: ['iot'],
  workspace: workspace([
    program(
      block('wifi_connect', { inputs: { SSID: t('SchoolWiFi'), PASSWORD: t('password') } }),
      forever(
        ifThen(
          block('wifi_connected'),
          [println(join(t('My IP: '), block('wifi_ip'))), println(block('http_get', { inputs: { URL: t('http://example.com/') } }))],
          [println(t('Not connected to Wi-Fi'))],
        ),
        wait(10),
      ),
    ),
  ]),
};

export const KIT_EXAMPLES: ExampleProject[] = [
  pedestrianCrossing,
  sensorReport,
  weatherStation,
  obstacleAvoider,
  colourSorter,
  tiltAlarm,
  bluetoothCar,
  smartGarden,
  wifiHello,
];
