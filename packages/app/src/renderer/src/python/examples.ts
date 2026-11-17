import { PYTHON_STARTER } from '@tariro-studio/core';

/** Short programs to start from; each shows one part of the `tariro` module. */
export const PYTHON_EXAMPLES: Array<{ id: string; name: string; code: string }> = [
  { id: 'hello', name: 'Hello, Python', code: PYTHON_STARTER },
  {
    id: 'blink',
    name: 'Blink the LED on pin 13',
    code: `from tariro import board, wait

# Blink ten times. Press Stop to end early.
for n in range(10):
    board.digital_write(13, True)
    wait(0.5)
    board.digital_write(13, False)
    wait(0.5)
    print("blink", n + 1)
`,
  },
  {
    id: 'sensor',
    name: 'Read a sensor on A0',
    code: `from tariro import board, wait

# Print the reading on A0 (a potentiometer or light sensor) as a bar, ten times a second.
while True:
    level = board.analog_read("A0")          # 0-1023
    percent = round(level * 100 / 1023)
    print(f"{percent:3d}% " + "#" * (percent // 4))
    wait(0.1)
`,
  },
  {
    id: 'servo',
    name: 'Sweep a servo on pin 9',
    code: `from tariro import board, wait

# Sweep a servo from 0 to 180 degrees and back, in 10-degree steps.
for angle in list(range(0, 181, 10)) + list(range(180, -1, -10)):
    board.servo_write(9, angle)
    wait(0.05)
print("Done")
`,
  },
  {
    id: 'maths',
    name: 'Prime numbers (no board needed)',
    code: `# Plain Python: find the prime numbers below 100.
primes = [n for n in range(2, 100) if all(n % d for d in range(2, int(n ** 0.5) + 1))]
print(len(primes), "primes below 100:")
print(primes)
`,
  },
];
