# Skybreak

A webcam energy fighter. You punch, guard, teleport and cast hand signs with your body.

## Run it

You need Python 3 (built into macOS) and Chrome or Edge.

```bash
cd skybreak2
python3 server.py
```

Open **http://localhost:8000** on the computer with the webcam. If macOS asks whether Python may accept incoming connections, allow it: the phone controller needs that.

You can also just double-click `index.html` to play. The camera and keyboard work that way, but the phone controller doesn't.

## Play online (two laptops)

Online play needs the game on an **https://** address, because browsers only allow the camera on secure pages. Upload this folder to any static host (GitHub Pages, Netlify, Cloudflare Pages), then:

1. Both players open the same address on their own laptops and pick a fighter.
2. One clicks **Host a match** and sends the 5-letter room code (or the invite link) to the other.
3. The other types the code and clicks **Join**. The host picks the stage.
4. Each player presses **Fight with camera** (or keyboard). The fight starts when both are ready.

The laptops connect directly to each other (WebRTC), so you don't need a game server. The PeerJS public service only introduces them. Some school or office networks block direct connections; if joining hangs, try a home network or a phone hotspot.

The host's game decides hits and damage. The other player's moves arrive with a small network delay.

## Phone controller (optional)

1. Put your phone on the same Wi-Fi as the computer.
2. In the game menu, choose **Movement → Phone joystick**.
3. Scan the QR code in the menu, or type the address the server prints (it looks like `http://192.168.x.x:8000/pad`).

Hold the phone in one hand. Steer with your thumb. The buttons are Vanish, Rush, Guard and Power up. The phone vibrates when you get hit (on Android; iPhones don't allow it from a web page).

## Controls with the camera

| Move | How |
|---|---|
| Jab / Cross | Left / right hand straight at the screen |
| Hook | Swing a fist out to the side and around |
| Uppercut | Drive a fist up from your waist to your chin |
| Hammer | Bring one fist down fast from above your head |
| Twin Palm | Thrust both hands forward together |
| Knee | Raise a knee fast (needs your legs in frame) |
| Guard | Cross your forearms in front of your face |
| Charge ki | Drop both fists to your hips |
| Transform | With a full Surge meter, hold the charge pose for a second |
| Vanish | Duck quickly. Right before a hit lands = Perfect Vanish |
| Rush | Lunge toward the screen |
| Blink | Hop (up) or slip sideways (left/right) |
| Specials | Each fighter's gestures and hand signs are listed in the menu |

Up close strikes hit; at range most of them fire a ki shot.

### Combos (every fighter)

Chain strikes less than a second apart. If your rival is out of reach, you dash in for the finisher.

| Combo | Strikes |
|---|---|
| Rapid Barrage | Jab, Jab, Jab, Jab |
| Triple Strike | Jab, Jab, Cross |
| Whirlwind Hook | Jab, Cross, Hook (breaks guard) |
| Ki Detonation | Any, Any, Twin Palm |
| Rising Fang | Cross, Uppercut |
| Sky Launcher | Hook, Uppercut (launches; air hits do 40% more) |
| Meteor Smash | Uppercut, Hammer (ground bounce) |
| Guard Crusher | Hook, Hook |
| Knee Lift | Knee, Uppercut |

First time with the camera, the game asks you to hold your guard and throw 5 punches with each hand. It learns your punch from that and saves it in the browser.

## Keyboard

`WASD` move · `J` jab · `K` cross · `L` hook · `I` uppercut · `U` hammer · `H` knee · `Y` twin palm · `G` guard · `C` charge · `Q` vanish · `E` rush · `Space` blink · `1`–`4` specials · `T` transform · `M` mute · `]` next song · `Esc` menu

A gamepad also works: left stick moves, A jab, X cross, Y hook, B uppercut, LB guard, RB vanish, LT/RT specials.
