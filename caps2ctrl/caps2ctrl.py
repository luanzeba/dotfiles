#!/usr/bin/env python
"""Make Caps Lock Escape when tapped and Control when used with another key."""

from dataclasses import dataclass
import sys

EV_KEY = 1
KEY_ESC = 1
KEY_LEFTCTRL = 29
KEY_CAPSLOCK = 58
KEY_RIGHTCTRL = 97


@dataclass(frozen=True)
class Event:
    type: int
    code: int
    value: int


class Caps2Ctrl:
    def __init__(self):
        self.pending = False
        self.synthetic_ctrl = False
        self.left_ctrl = False
        self.right_ctrl = False

    def handle(self, event):
        if event.type != EV_KEY:
            return [event]

        if event.code == KEY_CAPSLOCK:
            if event.value == 1:
                self.pending = True
            elif event.value == 0:
                if self.pending:
                    self.pending = False
                    return [Event(EV_KEY, KEY_ESC, 1), Event(EV_KEY, KEY_ESC, 0)]
                if self.synthetic_ctrl:
                    self.synthetic_ctrl = False
                    if not self.left_ctrl:
                        return [Event(EV_KEY, KEY_LEFTCTRL, 0)]
            return []

        if event.code == KEY_LEFTCTRL and event.value != 2:
            self.left_ctrl = event.value == 1
        elif event.code == KEY_RIGHTCTRL and event.value != 2:
            self.right_ctrl = event.value == 1

        output = []
        if self.pending and event.value == 1:
            self.pending = False
            if not (self.left_ctrl or self.right_ctrl):
                self.synthetic_ctrl = True
                output.append(Event(EV_KEY, KEY_LEFTCTRL, 1))

        # Keep a synthetic left Control held while the physical key changes.
        if event.code == KEY_LEFTCTRL and self.synthetic_ctrl:
            return output

        output.append(event)
        return output


def run(path):
    try:
        from evdev import InputDevice, UInput
    except ImportError as error:
        raise SystemExit("Install python-evdev first.") from error

    device = InputDevice(path)
    remapper = Caps2Ctrl()
    active = device.active_keys()
    remapper.left_ctrl = KEY_LEFTCTRL in active
    remapper.right_ctrl = KEY_RIGHTCTRL in active
    device.grab()
    ui = UInput.from_device(device, name="caps2ctrl built-in keyboard")

    try:
        for input_event in device.read_loop():
            event = Event(input_event.type, input_event.code, input_event.value)
            for output in remapper.handle(event):
                ui.write(output.type, output.code, output.value)
    finally:
        ui.close()
        device.ungrab()


if __name__ == "__main__":
    run(sys.argv[1])
