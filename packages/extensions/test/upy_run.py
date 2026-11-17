"""
Run a generated MicroPython program in CPython against stub `machine` and `dht` modules, with a
virtual clock, and report what it did to the pins as JSON (same notation as the live-mode test rig):
  "7=1"   digital pin 7 set high
  "5~127" PWM on pin 5, duty converted back to the blocks' 0-255 scale
  "9^90"  servo on pin 9 at 90 degrees (pulse width converted back to an angle)
Only for tests: it checks the generated code's behaviour, not MicroPython itself.
Usage: python3 -I upy_run.py < program.py   (inputs as JSON in argv[1], optional)
"""
import io
import json
import sys
import time
import types

inputs = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
log = []
clock = {"us": 0}
LIMIT_US = int(inputs.get("limit_s", 30) * 1_000_000)


class Done(Exception):
    pass


def advance(us):
    clock["us"] += int(us)
    if clock["us"] > LIMIT_US:
        raise Done()


time.sleep = lambda s: advance(s * 1_000_000)
time.sleep_ms = lambda ms: advance(ms * 1000)
time.sleep_us = lambda us: advance(us)
time.ticks_ms = lambda: clock["us"] // 1000
time.ticks_us = lambda: clock["us"]
time.ticks_diff = lambda a, b: a - b

machine = types.ModuleType("machine")


class Pin:
    OUT, IN, PULL_UP, IRQ_RISING, IRQ_FALLING = 1, 0, 2, 1, 2

    def __init__(self, n, mode=None, pull=None, value=None):
        self.n = n
        self.handler = None
        if value is not None:
            self.value(value)

    def value(self, v=None):
        if v is None:
            return int(inputs.get("digital", {}).get(str(self.n), 0))
        log.append(f"{self.n}={1 if v else 0}")

    def irq(self, trigger=None, handler=None):
        self.handler = handler
        pins_with_irq.append(self)


pins_with_irq = []


class PWM:
    def __init__(self, pin, freq=None, duty=None):
        self.n = pin.n
        if duty is not None:
            self.duty(duty)

    def duty(self, d):
        log.append(f"{self.n}~{round(d * 255 / 1023)}")

    def duty_ns(self, ns):
        log.append(f"{self.n}^{round((ns / 1000 - 544) * 180 / (2400 - 544))}")

    def deinit(self):
        pass


class ADC:
    ATTN_11DB = 3

    def __init__(self, pin):
        self.n = pin.n

    def atten(self, a):
        pass

    def read(self):
        return int(inputs.get("analog", {}).get(str(self.n), 0))


class I2C:
    def __init__(self, *a, **k):
        pass

    def readfrom_mem(self, addr, reg, n):
        raise OSError("no device")


def time_pulse_us(pin, level, timeout):
    return int(inputs.get("pulse_us", -1))


machine.Pin, machine.PWM, machine.ADC, machine.I2C, machine.time_pulse_us = Pin, PWM, ADC, I2C, time_pulse_us
sys.modules["machine"] = machine

dht = types.ModuleType("dht")


class _Dht:
    def __init__(self, pin):
        pass

    def measure(self):
        pass

    def temperature(self):
        return inputs.get("temp", 21.5)

    def humidity(self):
        return inputs.get("hum", 40)


dht.DHT11 = dht.DHT22 = _Dht
sys.modules["dht"] = dht

code = sys.stdin.read()
out = io.StringIO()
real_stdout, sys.stdout = sys.stdout, out
outcome = "finished"
try:
    env = {"__name__": "__main__"}
    exec(compile(code, "main.py", "exec"), env)
    # Encoder pulses: fire each registered interrupt handler the requested number of times.
    for _ in range(int(inputs.get("pulses", 0))):
        for p in pins_with_irq:
            p.handler(p)
    if "after" in inputs:
        exec(inputs["after"], env)
except Done:
    outcome = "time limit"
finally:
    sys.stdout = real_stdout
print(json.dumps({"log": log, "printed": out.getvalue(), "outcome": outcome, "ms": clock["us"] // 1000}))
