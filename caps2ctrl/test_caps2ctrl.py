import unittest

from caps2ctrl import (
    Caps2Ctrl,
    EV_KEY,
    Event,
    KEY_ESC,
    KEY_LEFTCTRL,
    KEY_CAPSLOCK,
)


class Caps2CtrlTest(unittest.TestCase):
    def test_tap_sends_escape(self):
        remapper = Caps2Ctrl()
        self.assertEqual(remapper.handle(Event(EV_KEY, KEY_CAPSLOCK, 1)), [])
        self.assertEqual(
            remapper.handle(Event(EV_KEY, KEY_CAPSLOCK, 0)),
            [Event(EV_KEY, KEY_ESC, 1), Event(EV_KEY, KEY_ESC, 0)],
        )

    def test_chord_sends_control(self):
        remapper = Caps2Ctrl()
        remapper.handle(Event(EV_KEY, KEY_CAPSLOCK, 1))
        self.assertEqual(
            remapper.handle(Event(EV_KEY, 30, 1)),
            [Event(EV_KEY, KEY_LEFTCTRL, 1), Event(EV_KEY, 30, 1)],
        )
        self.assertEqual(
            remapper.handle(Event(EV_KEY, KEY_CAPSLOCK, 0)),
            [Event(EV_KEY, KEY_LEFTCTRL, 0)],
        )

    def test_real_control_keeps_ownership(self):
        remapper = Caps2Ctrl()
        remapper.handle(Event(EV_KEY, KEY_CAPSLOCK, 1))
        remapper.handle(Event(EV_KEY, 30, 1))
        self.assertEqual(remapper.handle(Event(EV_KEY, KEY_LEFTCTRL, 1)), [])
        self.assertEqual(remapper.handle(Event(EV_KEY, KEY_CAPSLOCK, 0)), [])
        self.assertEqual(
            remapper.handle(Event(EV_KEY, KEY_LEFTCTRL, 0)),
            [Event(EV_KEY, KEY_LEFTCTRL, 0)],
        )


if __name__ == "__main__":
    unittest.main()
