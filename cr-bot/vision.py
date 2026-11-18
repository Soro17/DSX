"""Read the game state from a screenshot: elixir, cards in hand, enemy units."""
import os
from dataclasses import dataclass, field

import cv2
import numpy as np

import config

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "templates")


def _px(img, pos):
    h, w = img.shape[:2]
    return int(pos[0] * w), int(pos[1] * h)


def _crop(img, x1, y1, x2, y2):
    h, w = img.shape[:2]
    return img[int(y1 * h):int(y2 * h), int(x1 * w):int(x2 * w)]


def crop_card(img, slot_index):
    cx, cy = config.HAND_SLOTS[slot_index]
    return _crop(img, cx - config.CARD_HALF_W, cy - config.CARD_HALF_H,
                 cx + config.CARD_HALF_W, cy + config.CARD_HALF_H)


# ---- Elixir ----------------------------------------------------------------
def _is_elixir_pink(bgr):
    b, g, r = (int(v) for v in bgr)
    return r >= config.ELIXIR_MIN_R and b >= config.ELIXIR_MIN_B and g <= config.ELIXIR_MAX_G


def read_elixir(img):
    """Count filled elixir segments (0-10). Returns None if no bar is visible."""
    (x0, y0), (x1, y1) = config.ELIXIR_FIRST, config.ELIXIR_LAST
    count = 0
    for i in range(10):
        t = i / 9
        x, y = _px(img, (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
        # Average a small patch to be robust to the segment borders.
        patch = img[max(y - 2, 0):y + 3, max(x - 2, 0):x + 3].reshape(-1, 3).mean(axis=0)
        if _is_elixir_pink(patch):
            count += 1
        else:
            break  # the bar fills left to right
    return count


def battle_visible(img):
    """True if the elixir bar region contains elixir pink (i.e. we're in a battle)."""
    region = _crop(img, config.ELIXIR_FIRST[0] - 0.03, config.ELIXIR_FIRST[1] - 0.012,
                   config.ELIXIR_LAST[0] + 0.03, config.ELIXIR_LAST[1] + 0.012)
    return int(_pink_mask(region).sum()) > 20


def _pink_mask(region):
    b, g, r = region[..., 0].astype(int), region[..., 1].astype(int), region[..., 2].astype(int)
    return (r >= config.ELIXIR_MIN_R) & (b >= config.ELIXIR_MIN_B) & (g <= config.ELIXIR_MAX_G)


# ---- Enemies ---------------------------------------------------------------
@dataclass
class Threat:
    lane: str          # "left" or "right"
    x: float           # normalised centre
    y: float
    size: int          # number of red pixels (rough "how big is this push")


def _red_mask(region):
    b, g, r = region[..., 0].astype(int), region[..., 1].astype(int), region[..., 2].astype(int)
    return ((r >= config.ENEMY_RED_MIN_R) & (g <= config.ENEMY_RED_MAX_G)
            & (b <= config.ENEMY_RED_MAX_B)).astype(np.uint8)


def find_enemies(img, area=config.OUR_HALF):
    """Find clusters of enemy-red pixels inside `area`. Biggest first."""
    x1, y1, x2, y2 = area
    region = _crop(img, x1, y1, x2, y2)
    mask = _red_mask(region)
    # Join nearby specks (health bar + level badge + name) into one blob.
    mask = cv2.dilate(mask, np.ones((15, 15), np.uint8))
    n, _, stats, centroids = cv2.connectedComponentsWithStats(mask)
    rh, rw = region.shape[:2]
    raw = _red_mask(region)
    threats = []
    for i in range(1, n):
        bx, by, bw, bh, _ = stats[i]
        size = int(raw[by:by + bh, bx:bx + bw].sum())
        if size < config.ENEMY_MIN_PIXELS:
            continue
        cx = x1 + (centroids[i][0] / rw) * (x2 - x1)
        cy = y1 + (centroids[i][1] / rh) * (y2 - y1)
        threats.append(Threat("left" if cx < 0.5 else "right", cx, cy, size))
    threats.sort(key=lambda t: t.size, reverse=True)
    return threats


# ---- Cards in hand ----------------------------------------------------------
@dataclass
class CardMatcher:
    templates: dict = field(default_factory=dict)  # name -> grey image

    @classmethod
    def load(cls):
        m = cls()
        if os.path.isdir(TEMPLATE_DIR):
            for f in os.listdir(TEMPLATE_DIR):
                if f.lower().endswith(".png"):
                    img = cv2.imread(os.path.join(TEMPLATE_DIR, f), cv2.IMREAD_GRAYSCALE)
                    if img is not None:
                        m.templates[os.path.splitext(f)[0]] = img
        return m

    def identify(self, card_img):
        """Return (name, score) of the best-matching template, or (None, score)."""
        if not self.templates or card_img.size == 0:
            return None, 0.0
        grey = cv2.cvtColor(card_img, cv2.COLOR_BGR2GRAY)
        best, best_score = None, -1.0
        for name, tpl in self.templates.items():
            t = cv2.resize(tpl, (grey.shape[1], grey.shape[0]))
            score = float(cv2.matchTemplate(grey, t, cv2.TM_CCOEFF_NORMED).max())
            if score > best_score:
                best, best_score = name, score
        if best_score < config.CARD_MATCH_THRESHOLD:
            return None, best_score
        return best, best_score

    def read_hand(self, img):
        return [self.identify(crop_card(img, i))[0] for i in range(4)]
