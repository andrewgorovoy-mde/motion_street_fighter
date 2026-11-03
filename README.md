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
| Punch / blast | Snap a punch. Close up it hits; at range it fires a ki blast |
| Guard | Cross your forearms in front of your face |
| Charge ki | Drop both fists to your hips |
| Transform | With a full Surge meter, hold the charge pose for a second |
| Vanish | Duck quickly. Right before a hit lands = Perfect Vanish |
| Rush | Lunge toward the screen |
| Blink | Hop (up) or slip sideways (left/right) |
| Specials | Each fighter's gestures and hand signs are listed in the menu |

First time with the camera, the game asks you to hold your guard and throw 5 punches with each hand. It learns your punch from that and saves it in the browser.

## Keyboard

`WASD` move · `J` punch · `K` guard · `L` charge · `Q` vanish · `E` rush · `Space` blink · `U` / `O` specials · `I` ultimate · `P` super · `T` transform · `M` mute · `N` next song · `Esc` menu

A gamepad also works: left stick moves, A punches, B vanishes, Y rushes, X guards.
