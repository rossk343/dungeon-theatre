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

## Running (requires .NET 10 SDK and Node 20.19+)
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

## Status
Vertical slice: scenes with uploaded map images, a calibratable grid, a game-wide token library (name, HP) and per-scene placements, all synced over SignalR. Tokens keep their properties across scenes; a scene only stores where each token sits. State is persisted in SQLite via EF Core (`dungeon-theatre.db`, created and seeded on first run; migrations apply automatically on startup).

## Scenes and tokens

A game contains chapters, and chapters contain scenes. Use the **Chapters** panel to add, rename and delete chapters (a chapter must be empty to delete) and to pick a scene; change a scene's chapter from its **Scene** panel. Tokens belong to the game, not to a scene, so their name, HP and art are the same on every map; scenes only store where each token sits. There is a single game for now. Everyone can use **Measure** in the map controls: drag on the map to see the distance in feet and squares (counted like movement, with diagonals costing the same); Esc clears it. Measurements are local and not shared.

The GM can mark a scene as **Active** in the scene list. Changing the active scene switches connected players to it, and players cannot join other scenes until the GM changes the active scene again.

Tokens are a game-wide library; scenes only store placements. The **Tokens** tab manages player tokens only. NPCs live in the **Scene** tab: creating one there adds it to the current scene, and NPCs not on the scene are listed below it so they can be added or deleted. From the sidebar you can rename or delete scenes, and create tokens (name, colour, max HP, speed, armour class, vision and light ranges, optional art), replace their art, or delete them. Armour class is editable for all tokens by the GM and for player tokens by players; NPC armour class is GM-only. Vision and light ranges are GM-managed and default to 30 ft and 0 ft. Deleting a token removes it from every scene; deleting a scene leaves tokens intact. The database is seeded with sample data only when it is first created, so deleting everything won't bring the samples back.

## Initiative and movement

The panel on the left is the initiative tracker for the current scene. Its **Actions** section includes a shared dice roller for d4, d6, d8, d10, d12, d20, and d100, with up to 20 dice and an optional modifier; each roll and result is shown to everyone connected. Add placed tokens with an initiative (leave it blank to roll a d20), edit values inline, then **Start combat**. Order is highest initiative first; **Next turn** advances and increments the round when it wraps. Click a name to zoom the map to that token.

Each token has a speed in feet (default 30, editable in the Tokens list). During combat only the token whose turn it is is metered: every square, diagonals included, costs the scene's feet per square (5 by default), and a drag that would exceed the remaining movement is rejected and the token snaps back. **Reset move** returns the current token to its position at the start of its turn and restores its movement; the GM can do this for any turn, and players can do it on a player token's turn. The GM can move any token; players can move any player token, but during combat only when that token has the current turn.

## Accounts and roles

The first account registered becomes the GM; that first registration does not need an invite code. The GM can share the displayed invite code with players, who can create password accounts or join as guests. Guests are players too. Accounts use a username and password for now; SSO is a future option.

The GM manages scenes, chapters, token creation and placement, and combat setup. The GM can mark tokens as player-controlled or NPC/enemy-controlled. The player token panel lists only player-controlled tokens; NPCs remain visible in the initiative tracker. Players can edit the name, HP, speed, armour class and art of any player token, and can move any player token outside combat. NPC HP and armour class are hidden from players; they see red, amber, or green boxes for NPC health (red at 25% or less, amber above 25% through 50%, green above 50%). In combat, only the current player token can be moved by a player, and players may advance a player token's turn. The server enforces these permissions; hiding controls in the client is only a usability measure. The auth cookie is HttpOnly and SameSite=Strict.

## Map images and grid
- Create a scene from the **New scene** panel (name plus a PNG, JPEG, WebP or GIF), or use **Replace map image** on an existing scene.
- Uploads are limited to 25 MB and 10000x10000 px. The server identifies the file type from its bytes (not the filename), stores it under `server/DungeonTheatre.Api/uploads/` with a random name and serves it at `/uploads/...`. That folder is git-ignored.
- **Navigation:** scroll to zoom toward the cursor, drag empty space to pan, and use the +/−/Fit buttons in the corner. Views are local to each browser; changing the active scene sends players the view the GM will use for that scene, and **Show players** shares the current view again.
- **Grid** panel: set the square size and X/Y offset to match the map's printed squares. Changes preview live and are shared with everyone when you press **Save grid**.
- Token positions are stored in map pixels, so recalibrating the grid never moves tokens.
- Players see a circular area around placed player tokens, using the larger of each token's vision and light ranges. Distances are converted through the scene's grid size and feet-per-square setting. The GM sees the full map. Use **Draw fog** and click map points to add an opaque polygon that stays hidden from players; **Finish area**, clicking the first point, or double-clicking finishes it (Esc cancels), and clicking a gold-outlined area lets the GM remove it. Fog polygons hide areas even inside token vision. Use **Draw walls** to click wall segments (placed freely; hold Shift to snap to grid corners): walls block player vision and player token movement, the GM ignores them, and clicking a wall removes it.

## Database changes
```
cd server/DungeonTheatre.Api
dotnet tool install --global dotnet-ef
dotnet ef migrations add <Name> -o Data/Migrations
```
Delete `dungeon-theatre.db` (and the `uploads` folder) to reset to the seed data.
