"""
Practice bot. Start a Training Camp match yourself, then run:

    python bot.py            play battles until you press Ctrl+C
    python bot.py --dry-run  only print what it WOULD do (no taps)
    python bot.py --learn    save pictures of the 4 cards in your hand
"""
import argparse
import os
import time

import cv2

import config
import strategy
import vision
from device import Device


def learn(dev):
    os.makedirs(vision.TEMPLATE_DIR, exist_ok=True)
    img = dev.screenshot()
    print("Name each card in your hand (e.g. hog_rider). Leave empty to skip.")
    for i in range(4):
        crop = vision.crop_card(img, i)
        preview = os.path.join(vision.TEMPLATE_DIR, "_preview.png")
        cv2.imwrite(preview, crop)
        name = input(f"  Slot {i + 1} (picture saved to {preview}): ").strip().lower()
        if name:
            cv2.imwrite(os.path.join(vision.TEMPLATE_DIR, f"{name}.png"), crop)
            if name not in strategy.CARDS:
                print(f"    Note: add \"{name}\" with its cost and role to cards.json")
    os.remove(preview)
    print("Done. Cycle your deck in Training Camp and run --learn again for the other cards.")


def play(dev, dry_run, max_battles):
    matcher = vision.CardMatcher.load()
    if not matcher.templates:
        print("No card pictures yet; every card is treated as a 4-elixir defender. "
              "Run `python bot.py --learn` during a battle for smarter play.")
    battles = 0
    in_battle = False
    last_seen = 0.0
    mem = strategy.Memory()
    print("Waiting for a battle... (Ctrl+C to stop)")

    while True:
        img = dev.screenshot()
        now = time.time()

        if vision.battle_visible(img):
            if not in_battle:
                in_battle, mem = True, strategy.Memory()
                print(f"\n=== Battle {battles + 1} started ===")
            last_seen = now
        elif in_battle and now - last_seen > config.BATTLE_END_TIMEOUT:
            in_battle = False
            battles += 1
            print(f"=== Battle {battles} over ===")
            if max_battles and battles >= max_battles:
                return
            print("Start the next Training Camp match when ready.")

        if in_battle and now - last_seen < 1.0:
            elixir = vision.read_elixir(img)
            hand = matcher.read_hand(img)
            threats = vision.find_enemies(img)
            action = strategy.decide(elixir, hand, threats, now, mem)
            if action:
                name = hand[action.slot] or f"slot {action.slot + 1}"
                print(f"[{elixir} elixir] {name} -> {action.reason}")
                if not dry_run:
                    dev.play_card(action.slot, action.target)
                    time.sleep(0.8)   # let the elixir bar update

        time.sleep(config.LOOP_DELAY)


def main():
    p = argparse.ArgumentParser(description="Clash Royale Training Camp practice bot")
    p.add_argument("--learn", action="store_true", help="save the cards in hand as templates")
    p.add_argument("--dry-run", action="store_true", help="don't tap, just print decisions")
    p.add_argument("--battles", type=int, default=0, help="stop after N battles (0 = forever)")
    args = p.parse_args()

    dev = Device()
    print(f"Connected: {dev.width}x{dev.height}")
    try:
        learn(dev) if args.learn else play(dev, args.dry_run, args.battles)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
