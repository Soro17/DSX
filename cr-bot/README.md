# CR Practice Bot

A simple bot that plays **Training Camp** matches in Clash Royale on an Android
emulator on your PC. It reads the screen (elixir, your cards, enemy units) and
taps to place cards.

> ⚠️ **Read this first.** Supercell's Terms of Service forbid bots, even in
> Training Camp, and accounts can be banned for it. Use a **second (throwaway)
> account**, and only use it in Training Camp. Never use it in ladder,
> tournaments or friendly battles against real people.

## 1. Setup (Windows)

1. Install an emulator, for example **BlueStacks 5**. Set it to **portrait / phone**
   mode with a resolution of 720x1280 or 1080x1920.
2. In BlueStacks go to *Settings → Advanced* and turn on **Android Debug Bridge (ADB)**.
   Note the port it shows, for example `127.0.0.1:5555`.
3. Install the [Android platform-tools](https://developer.android.com/tools/releases/platform-tools)
   (this provides `adb.exe`) and either add them to your PATH or set `ADB_PATH` in `config.py`.
4. Install **Python 3.10+**, then run this in the `cr-bot` folder:
   ```bash
   pip install -r requirements.txt
   ```
5. Set `DEVICE` in `config.py` to the port from step 2.

## 2. Calibrate

Start a Training Camp match, then run:
```bash
python calibrate.py
```
Open `calibration.png`. The green boxes should sit on your 4 cards and the blue
circles on the elixir bar. If they don't, nudge the numbers in `config.py`. All
the numbers are fractions of the screen size.

## 3. Teach it your deck

During a battle, run:
```bash
python bot.py --learn
```
Type the name of each card in your hand, for example `hog_rider`. Play a few
cards so new ones cycle into your hand, then repeat until all 8 are saved in
`templates/`. Every name should also appear in `cards.json` with its cost and role
(`tank`, `support`, `defender`, `swarm`, `spell`, `building` or `win_condition`).

## 4. Run

```bash
python bot.py --dry-run
```
This only prints decisions. Use it to check the bot reads the game correctly.
```bash
python bot.py
```
This plays for real. Start each Training Camp match yourself, and press **Ctrl+C** to stop.

## How it thinks (`strategy.py`)

1. **Enemy on our side?** Red health bars below the river count as a threat.
   For a big group it uses a spell if it has one. Otherwise it places a building,
   or the cheapest defender just in front of the threat.
2. **Lots of elixir (9+)?** It places a tank behind the princess tower, then a
   support card behind it 2 seconds later. If it has no tank, it sends its win
   condition to the bridge.
3. **Full elixir (10)?** It cycles the cheapest card so no elixir is wasted.

All the logic is in `strategy.py`, so you can experiment with your own ideas there.
