# caps2ctrl

Caps Lock sends Escape when tapped and Left Control when held with another key.

The system service reads only `/dev/input/by-path/platform-i8042-serio-0-event-kbd`, the laptop's built-in AT keyboard. USB keyboards, including the ZSA, are not opened or remapped.

```sh
python -m unittest
sudo -v
dot install caps2ctrl
```

The dotfiles installer installs `python-evdev`, copies the script to `/usr/local/lib/caps2ctrl`, and enables `caps2ctrl.service` at boot.
