"""
Settings for the practice bot.

Every screen position is NORMALISED: x and y go from 0.0 (left/top) to 1.0
(right/bottom). That way the same numbers work at 720x1280, 1080x1920, etc.
If something is off on your emulator, run `python calibrate.py` and adjust here.
"""

# ---- Emulator / ADB --------------------------------------------------------
# BlueStacks: Settings > Advanced > Android Debug Bridge = ON, it shows the port.
# LDPlayer / MEmu / Nox use other ports (5555, 21503, 62001 ...).
import os as _os
import shutil as _shutil

# Use adb from PATH, otherwise the one that ships with BlueStacks / platform-tools.
_ADB_CANDIDATES = [
    r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe",
    r"C:\Program Files\BlueStacks\HD-Adb.exe",
    _os.path.join(_os.path.dirname(__file__), "platform-tools", "adb.exe"),
    r"C:\platform-tools\adb.exe",
]
ADB_PATH = _shutil.which("adb") or next((p for p in _ADB_CANDIDATES if _os.path.exists(p)), "adb")
DEVICE = "127.0.0.1:5555"         # set to None to use the only connected device

# ---- Hand (the 4 playable cards at the bottom) -----------------------------
HAND_SLOTS = [(0.335, 0.885), (0.505, 0.885), (0.675, 0.885), (0.845, 0.885)]
# Half-size of the box cropped around each slot centre (normalised)
CARD_HALF_W = 0.070
CARD_HALF_H = 0.055

# ---- Elixir bar -------------------------------------------------------------
# Centre of the 1st and 10th elixir segment; the 8 in between are interpolated.
ELIXIR_FIRST = (0.315, 0.968)
ELIXIR_LAST = (0.945, 0.968)

# ---- Arena ------------------------------------------------------------------
RIVER_Y = 0.445                   # the river line
OUR_HALF = (0.03, 0.47, 0.97, 0.80)   # x1, y1, x2, y2 area scanned for enemies
ENEMY_HALF = (0.03, 0.08, 0.97, 0.42)

LANE_X = {"left": 0.22, "right": 0.78}

# Where to drop cards (per lane)
POS_DEFEND = {"left": (0.33, 0.62), "right": (0.67, 0.62)}   # pulls enemies to centre
POS_TANK_BACK = {"left": (0.22, 0.77), "right": (0.78, 0.77)}  # behind princess tower
POS_SUPPORT = {"left": (0.22, 0.70), "right": (0.78, 0.70)}
POS_BRIDGE = {"left": (0.22, 0.50), "right": (0.78, 0.50)}
POS_BUILDING = (0.50, 0.60)

# ---- Colour thresholds (BGR, as OpenCV uses) --------------------------------
# Enemy units have red health bars / level badges.
ENEMY_RED_MIN_R = 190
ENEMY_RED_MAX_G = 70
ENEMY_RED_MAX_B = 80
ENEMY_MIN_PIXELS = 25             # ignore tiny specks

# Filled elixir segments are magenta / pink.
ELIXIR_MIN_R = 150
ELIXIR_MIN_B = 150
ELIXIR_MAX_G = 120

# ---- Behaviour --------------------------------------------------------------
LOOP_DELAY = 0.35                 # seconds between decisions
ATTACK_ELIXIR = 9                 # start a push when we have this much
SUPPORT_DELAY = 2.0               # seconds after a tank before the support card
CARD_MATCH_THRESHOLD = 0.70       # template match score needed to recognise a card
BATTLE_END_TIMEOUT = 8.0          # seconds without an elixir bar = battle over
