"""
Takes a screenshot during a battle and draws everything the bot "sees" on it,
so you can check the positions in config.py line up with your emulator.

    python calibrate.py              (needs the emulator)
    python calibrate.py shot.png     (use a saved screenshot instead)

Open calibration.png: boxes should sit on your cards, dots on the elixir bar.
"""
import sys

import cv2

import config
import vision


def annotate(img):
    h, w = img.shape[:2]
    P = lambda p: (int(p[0] * w), int(p[1] * h))
    out = img.copy()

    for i, (cx, cy) in enumerate(config.HAND_SLOTS):
        cv2.rectangle(out, P((cx - config.CARD_HALF_W, cy - config.CARD_HALF_H)),
                      P((cx + config.CARD_HALF_W, cy + config.CARD_HALF_H)), (0, 255, 0), 2)
        cv2.putText(out, str(i + 1), P((cx - 0.01, cy)), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

    (x0, y0), (x1, y1) = config.ELIXIR_FIRST, config.ELIXIR_LAST
    for i in range(10):
        t = i / 9
        cv2.circle(out, P((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)), 6, (255, 255, 0), 2)

    x1_, y1_, x2_, y2_ = config.OUR_HALF
    cv2.rectangle(out, P((x1_, y1_)), P((x2_, y2_)), (255, 0, 255), 2)
    cv2.line(out, P((0, config.RIVER_Y)), P((1, config.RIVER_Y)), (255, 128, 0), 2)
    for group in (config.POS_DEFEND, config.POS_TANK_BACK, config.POS_SUPPORT, config.POS_BRIDGE):
        for pos in group.values():
            cv2.drawMarker(out, P(pos), (0, 255, 255), cv2.MARKER_CROSS, 20, 2)

    for t in vision.find_enemies(img):
        cv2.circle(out, P((t.x, t.y)), 25, (0, 0, 255), 3)

    print(f"Screen {w}x{h} | elixir read: {vision.read_elixir(img)} | "
          f"battle visible: {vision.battle_visible(img)} | "
          f"enemies on our side: {len(vision.find_enemies(img))}")
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1:
        img = cv2.imread(sys.argv[1])
    else:
        from device import Device
        img = Device().screenshot()
        cv2.imwrite("screenshot.png", img)
    cv2.imwrite("calibration.png", annotate(img))
    print("Saved calibration.png")
