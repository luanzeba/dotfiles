#!/usr/bin/env python
"""Make Caps Lock Escape when tapped and Control when held or clicked."""

from dataclasses import dataclass
from glob import glob
from selectors import DefaultSelector, EVENT_READ
import os
import sys

EV_KEY = 1
KEY_ESC = 1
KEY_LEFTCTRL = 29
KEY_CAPSLOCK = 58
KEY_RIGHTCTRL = 97
BTN_MOUSE = 0x110
BTN_TASK = 0x117


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

    def pointer_down(self):
        self.pending = False

    def handle(self, event):
        if event.type != EV_KEY:
            return [event]

        if event.code == KEY_CAPSLOCK:
            if event.value == 1 and not self.pending:
                self.pending = not (self.left_ctrl or self.right_ctrl)
                if self.pending:
                    self.synthetic_ctrl = True
                    return [Event(EV_KEY, KEY_LEFTCTRL, 1)]
            elif event.value == 0:
                output = []
                if self.synthetic_ctrl:
                    self.synthetic_ctrl = False
                    if not self.left_ctrl:
                        output.append(Event(EV_KEY, KEY_LEFTCTRL, 0))
                if self.pending:
                    output.extend([Event(EV_KEY, KEY_ESC, 1), Event(EV_KEY, KEY_ESC, 0)])
                self.pending = False
                return output
            return []

        if event.code == KEY_LEFTCTRL and event.value != 2:
            self.left_ctrl = event.value == 1
        elif event.code == KEY_RIGHTCTRL and event.value != 2:
            self.right_ctrl = event.value == 1

        if self.pending and event.value == 1:
            self.pending = False

        # Keep the synthetic left Control held while the physical key changes.
        if event.code == KEY_LEFTCTRL and self.synthetic_ctrl:
            return []

        return [event]


def is_mouse_button_down(event):
    return event.type == EV_KEY and BTN_MOUSE <= event.code <= BTN_TASK and event.value == 1


def mouse_devices(keyboard_path, input_device):
    keyboard_path = os.path.realpath(keyboard_path)
    for path in glob("/dev/input/event*"):
        if os.path.realpath(path) == keyboard_path:
            continue
        try:
            device = input_device(path)
            buttons = device.capabilities().get(EV_KEY, [])
            if any(BTN_MOUSE <= button <= BTN_TASK for button in buttons):
                yield device
            else:
                device.close()
        except OSError:
            continue


def run(path):
    try:
        from evdev import InputDevice, UInput
    except ImportError as error:
        raise SystemExit("Install python-evdev first.") from error

    keyboard = InputDevice(path)
    remapper = Caps2Ctrl()
    active = keyboard.active_keys()
    remapper.left_ctrl = KEY_LEFTCTRL in active
    remapper.right_ctrl = KEY_RIGHTCTRL in active
    pointers = list(mouse_devices(path, InputDevice))
    keyboard.grab()
    ui = UInput.from_device(keyboard, name="caps2ctrl built-in keyboard")

    try:
        with DefaultSelector() as selector:
            selector.register(keyboard, EVENT_READ, True)
            for pointer in pointers:
                selector.register(pointer, EVENT_READ, False)

            while True:
                for key, _ in selector.select():
                    for input_event in key.fileobj.read():
                        event = Event(input_event.type, input_event.code, input_event.value)
                        if key.data:
                            for output in remapper.handle(event):
                                ui.write(output.type, output.code, output.value)
                        elif is_mouse_button_down(event):
                            remapper.pointer_down()
    finally:
        ui.close()
        keyboard.ungrab()
        keyboard.close()
        for pointer in pointers:
            pointer.close()


if __name__ == "__main__":
    run(sys.argv[1])
