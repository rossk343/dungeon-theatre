# Dungeon Theatre

A personal virtual tabletop for dark fantasy campaigns: view maps on a grid, place and move player tokens, and sync everything in real time.

## Stack
- **Client**: React + TypeScript + Vite, react-konva for the map canvas
- **Server**: ASP.NET Core Web API, SignalR for real-time sync, EF Core
- **Database**: SQLite to start, PostgreSQL later

## Structure
```
server/   ASP.NET Core API and SignalR hub
client/   React front end
```

## Roadmap
1. Vertical slice: hardcoded map, draggable tokens, SignalR sync between two tabs
2. Accounts and roles (local username/password, invite codes)
3. Map uploads and grid calibration
4. Permissions (GM vs player, hidden tokens)
5. Fog of war, chat and dice, measuring, initiative

## Running from source (requires .NET 10 SDK and Node 20.19+)
```
# terminal 1
cd server/DungeonTheatre.Api
dotnet run --launch-profile http

# terminal 2
cd client
npm install
npm run dev
```
Open http://localhost:5173 in two browser tabs and drag a token; it moves in both. Vite proxies `/hubs` and `/api` to the API on port 5092.

## Portable Windows host

### Build the app

On a Windows x64 build machine, install the .NET 10 SDK and Node 20.19 or later. From the repository root, run in PowerShell:

```powershell
cd client
npm install
cd ..
.\scripts\publish-windows.ps1
```

The script builds the website and creates a self-contained app in `artifacts\windows-x64`. Copy or zip **the entire folder**, not just the EXE, to share it. The host PC does not need Node or .NET installed.

### Host a game

1. Extract the folder if necessary, then double-click `DungeonTheatre.Api.exe`. Keep its console window open while playing.
2. On the host PC, open `http://localhost:8080` in a browser. Create the GM account before inviting others: the first account registered becomes the GM.
3. Give players the invite code shown in the app and one of the local network addresses printed in the console, such as `http://192.168.1.10:8080`. Players on the same network can open that address in their browsers and join as guests or register.
4. If Windows Firewall prompts for access, allow it on private networks; a firewall rule may be needed for TCP port 8080. Some listed addresses may belong to virtual adapters, so use the host's actual Wi-Fi or Ethernet address.
5. To stop hosting, press Ctrl+C in the console or close the window.

The host uses HTTP and is intended for a trusted local network, not direct exposure to the internet; passwords and game traffic are not encrypted over the network.

If port 8080 is already in use, launch from PowerShell with a different port:

```powershell
$env:ASPNETCORE_URLS = 'http://0.0.0.0:8081'
.\DungeonTheatre.Api.exe
```

Use that port in the browser and firewall rule.

### Game data and updates

The portable host stores its database, uploaded images and authentication keys in `%LOCALAPPDATA%\DungeonTheatre`, separately from both the app folder and the development database. To choose another location, set `DungeonTheatre__DataDirectory` to an absolute path before launching. Back up that whole folder with the server stopped; keep its authentication keys private. Replacing the app folder with a newer version leaves this data intact, and database migrations run on startup. To move an existing development campaign, stop both servers and copy `server\DungeonTheatre.Api\dungeon-theatre.db` and its `uploads` folder into that data folder; existing login sessions will need to sign in again.

## Status
Vertical slice: scenes with uploaded map images, a calibratable grid, a game-wide token library (name, HP) and per-scene placements, all synced over SignalR. Tokens keep their properties across scenes; a scene only stores where each token sits. State is persisted in SQLite via EF Core (`dungeon-theatre.db`, created and seeded on first run; migrations apply automatically on startup).

## Scenes and tokens

A game contains chapters, and chapters contain scenes. Use the **Chapters** panel to add, rename and delete chapters (a chapter must be empty to delete) and to pick a scene; change a scene's chapter from its **Scene** panel. Tokens belong to the game, not to a scene, so their name, HP and art are the same on every map; scenes only store where each token sits. There is a single game for now. Everyone can use **Measure** in the map controls: drag on the map to see the distance in feet and squares (counted like movement, with diagonals costing the same); Esc clears it. Measurements are local and not shared.

The GM can mark a scene as **Active** in the scene list. Changing the active scene switches connected players to it, and players cannot join other scenes until the GM changes the active scene again.

Tokens are a game-wide library; scenes only store placements. The **Tokens** tab manages player and item tokens. NPCs live in the **Scene** tab: creating one there adds it to the current scene, and NPCs not on the scene are listed below it so they can be added or deleted. From the sidebar you can rename or delete scenes, and create tokens (name, colour, max HP, speed, armour class, vision and light ranges, optional art), replace their art, or delete them. Armour class is editable for combatants by the GM and for player tokens by players; NPC armour class is GM-only. Vision and light ranges are GM-managed and default to 30 ft and 0 ft. Deleting a token removes it from every scene; deleting a scene leaves tokens intact. The database is seeded with sample data only when it is first created, so deleting everything won't bring the samples back.

The GM can use the **Players** and **Items** tabs within **Tokens** to manage each category. Create items in **Items**, choose whether players or the GM control them, and add them to scenes. Items have no combat stats, initiative or vision, but can emit light within areas visible to players. Players can edit and move player-controlled items; during combat they may move them only on a player combatant's turn. Item movement is not metered. The GM can set an item's size and aura per scene, just like other tokens.

## Initiative and movement

Press Enter to apply inline token and initiative edits, or to save edited grid settings.

The GM can set an aura radius (in feet from the token's center) and colour for any placed player, NPC or item in the current scene. Set the radius to 0 to remove it. Auras are translucent, move with the token, and remain obscured by fog and darkness.

The GM can set the size of a placed player, NPC or item token in its current scene: Medium (1×1), Large (2×2), Huge (3×3), or Gargantuan (4×4). Other scenes retain their own sizes. Larger tokens snap to the grid, and player movement checks their full footprint against walls.

The **Foe slain!** notification appears for 10 seconds, over the map on desktop and on any tab on mobile.

On mobile, players can also use **Reset move** from the map toolbar during a player token's turn.

The panel on the left is the initiative tracker for the current scene. Its **Actions** section includes a shared dice roller for d4, d6, d8, d10, d12, d20, and d100, with up to 10 rows (use **+ Add dice**) of up to 20 dice each and one optional modifier; each roll and result is shown to everyone connected. On a player token's turn, click an NPC in the initiative order on the map to target it (red dashed ring; click again or press ✕ to clear): the Roll button becomes **Attack**, and the same dice roll is compared on the server to the NPC's AC, showing Hit or Miss to everyone without revealing the AC. After a hit, a **Roll damage** button appears: set your weapon's dice and modifier, then roll. The roll is announced to everyone; player damage awaits the GM's approval before it is subtracted from the NPC's HP (never below 0), while the GM's own damage applies immediately. An NPC reduced to 0 HP (by damage or a GM edit) gets a red ✕ on its token, is removed from initiative, and shows a **Foe slain!** notification to players. The server only accepts a damage roll right after a hit on that target in the same turn. A popup on the GM screen shows the roller, amount and target, and **Accept** applies player damage while **Reject** discards it. The panel also has a **Dash** button on a player token's turn: it doubles that turn's movement allowance but the player can't attack after dashing (the server rejects it); it resets when the turn changes. Add placed tokens with an initiative (leave it blank to roll a d20), edit values inline, then **Start combat**. Order is highest initiative first; **Next turn** advances and increments the round when it wraps. Click a name to zoom the map to that token.

Each token has a speed in feet (default 30, editable in the Tokens list). During combat only the token whose turn it is is metered: every square, diagonals included, costs the scene's feet per square (5 by default), and a drag that would exceed the remaining movement is rejected and the token snaps back. **Reset move** returns the current token to its position at the start of its turn and restores its movement (and clears a Dash); the GM can do this for any turn, and players can do it on a player token's turn. The GM can move any token; players can move any player token, but during combat only when that token has the current turn.

## Accounts and roles

The first account registered becomes the GM; that first registration does not need an invite code. The GM can share the displayed invite code with players, who can create password accounts or join as guests. Guests are players too. Accounts use a username and password for now; SSO is a future option.

The GM manages scenes, chapters, token creation and placement, and combat setup. The GM can mark tokens as player-controlled or NPC/enemy-controlled. The player token panel lists only player-controlled tokens; NPCs remain visible in the initiative tracker. Players can edit the name, HP, speed, armour class and art of any player token, and can move any player token outside combat. NPC HP and armour class are hidden from players; they see red, amber, or green boxes for NPC health (red at 25% or less, amber above 25% through 50%, green above 50%). In combat, only the current player token can be moved by a player, and players may advance a player token's turn. The server enforces these permissions; hiding controls in the client is only a usability measure. The auth cookie is HttpOnly and SameSite=Strict.

## Map images and grid
- Create a scene from the **New scene** panel (name plus a PNG, JPEG, WebP or GIF), or use **Replace map image** on an existing scene.
- Uploads are limited to 25 MB and 10000x10000 px. The server identifies the file type from its bytes (not the filename), stores it under `server/DungeonTheatre.Api/uploads/` with a random name and serves it at `/uploads/...`. That folder is git-ignored.
- **Navigation:** scroll to zoom toward the cursor, drag empty space to pan, and use the +/−/Fit buttons in the corner. Views are local to each browser; changing the active scene sends players the view the GM will use for that scene, and **Show players** shares the current view again.
- **Grid** panel: set the square size and X/Y offset to match the map's printed squares. Changes preview live and are shared with everyone when you press **Save grid**.
- Token positions are stored in map pixels, so recalibrating the grid never moves tokens.
- Players see a circular area around placed player tokens, using the larger of each token's vision and light ranges. Distances are converted through the scene's grid size and feet-per-square setting. The GM sees the full map. Pick **Draw fog** from the drawing-tool dropdown and click map points to add an opaque polygon that stays hidden from players; **Finish area**, clicking the first point, or double-clicking finishes it (Esc cancels), and clicking a gold-outlined area lets the GM remove it. Fog polygons hide areas even inside token vision. Choose **Draw walls** from the same dropdown to click wall segments (placed freely; hold Shift to snap to grid corners): walls block player vision and player token movement, the GM ignores them, and clicking a wall removes it. The **Lighting** toggle turns darkness and token vision off per scene so players see the whole map (fog and walls still apply).

## Database changes
```
cd server/DungeonTheatre.Api
dotnet tool install --global dotnet-ef
dotnet ef migrations add <Name> -o Data/Migrations
```
Delete `dungeon-theatre.db` (and the `uploads` folder) to reset to the seed data.
