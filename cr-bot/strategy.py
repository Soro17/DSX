"""
Decision making. Pure logic, no screen/ADB code, so it is easy to test and tweak.

decide() looks at elixir, the cards in hand and enemy units on our side, and
returns an Action (which hand slot to play and where) or None to wait.
"""
import json
import os
import random
from dataclasses import dataclass

import config

with open(os.path.join(os.path.dirname(__file__), "cards.json")) as f:
    CARDS = {k: v for k, v in json.load(f).items() if not k.startswith("_")}

UNKNOWN = {"cost": 4, "role": "defender"}   # used when a card isn't recognised
TROOP_ROLES = ("defender", "swarm", "support", "tank", "win_condition")


@dataclass
class Action:
    slot: int
    target: tuple
    reason: str


@dataclass
class Memory:
    """Things the bot remembers between decisions."""
    attack_lane: str = "right"
    support_due_at: float | None = None
    support_lane: str | None = None


def info(name):
    return CARDS.get(name, UNKNOWN) if name else UNKNOWN


def _playable(hand, elixir, roles):
    """Slots whose card has one of `roles` and is affordable, cheapest first."""
    opts = [(info(n)["cost"], i) for i, n in enumerate(hand)
            if info(n)["role"] in roles and info(n)["cost"] <= elixir]
    return [i for _, i in sorted(opts)]


def _defend_spot(threat):
    # Drop slightly in front of the threat (closer to our towers) and pulled
    # toward the middle, so the enemy gets distracted and both towers help.
    x = threat.x + (0.5 - threat.x) * 0.35
    y = min(threat.y + 0.08, 0.76)
    return (x, y)


def decide(elixir, hand, threats, now, mem: Memory):
    # 1) Defend if something is on our side of the river.
    if threats:
        t = threats[0]
        total = sum(th.size for th in threats if th.lane == t.lane)

        if total > 250:  # a big group: spell it if we can
            for i in _playable(hand, elixir, ("spell",)):
                return Action(i, (t.x, t.y), f"spell on big push in {t.lane} lane")

        for i in _playable(hand, elixir, ("building",)):
            if t.y > 0.55:   # only when it's actually coming in
                return Action(i, config.POS_BUILDING, "building to pull the push")

        for i in _playable(hand, elixir, ("defender", "swarm", "support")):
            return Action(i, _defend_spot(t), f"defend {t.lane} lane")

        # Nothing cheap in hand: wait unless we're about to waste elixir.
        if elixir < 10:
            return None

    # 2) Follow up a tank with a support card.
    if mem.support_due_at and now >= mem.support_due_at:
        mem.support_due_at = None
        for i in _playable(hand, elixir, ("support",)) + _playable(hand, elixir, ("defender",)):
            return Action(i, config.POS_SUPPORT[mem.support_lane], "support behind tank")

    # 3) Start a push when we have plenty of elixir.
    if elixir >= config.ATTACK_ELIXIR:
        lane = mem.attack_lane
        for i in _playable(hand, elixir, ("tank",)):
            mem.support_due_at = now + config.SUPPORT_DELAY
            mem.support_lane = lane
            return Action(i, config.POS_TANK_BACK[lane], f"tank push {lane} lane")
        for i in _playable(hand, elixir, ("win_condition",)):
            return Action(i, config.POS_BRIDGE[lane], f"win condition at {lane} bridge")
        if elixir >= 10:
            # Don't leak elixir: cycle the cheapest troop at the back.
            for i in _playable(hand, elixir, TROOP_ROLES):
                mem.attack_lane = random.choice(["left", "right"])
                return Action(i, config.POS_SUPPORT[lane], "cycle a card (full elixir)")

    return None
