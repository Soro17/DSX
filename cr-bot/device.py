"""Talk to the Android emulator through ADB: screenshots and taps."""
import subprocess

import cv2
import numpy as np

import config


class Device:
    def __init__(self, adb=config.ADB_PATH, serial=config.DEVICE):
        self.adb = adb
        self.serial = serial
        if serial and ":" in serial:
            # Network devices (emulators) need an explicit connect.
            subprocess.run([adb, "connect", serial], capture_output=True, timeout=10)
        self.width, self.height = self.screenshot().shape[1::-1]
        if self.width > self.height:
            raise SystemExit(
                f"Screen is {self.width}x{self.height} (landscape). "
                "Set the emulator to PORTRAIT / phone mode and try again."
            )

    def _cmd(self, *args):
        base = [self.adb]
        if self.serial:
            base += ["-s", self.serial]
        return base + list(args)

    def screenshot(self):
        """Return the current screen as an OpenCV BGR image."""
        out = subprocess.run(self._cmd("exec-out", "screencap", "-p"),
                             capture_output=True, timeout=10).stdout
        img = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(
                "Could not get a screenshot. Is the emulator running and is "
                f"`{self.adb} devices` showing it?"
            )
        return img

    def to_px(self, pos):
        x, y = pos
        return int(x * self.width), int(y * self.height)

    def tap(self, pos):
        x, y = self.to_px(pos)
        subprocess.run(self._cmd("shell", "input", "tap", str(x), str(y)),
                       capture_output=True, timeout=10)

    def play_card(self, slot_index, target):
        """Select a card from the hand, then tap where it should go."""
        self.tap(config.HAND_SLOTS[slot_index])
        self.tap(target)
