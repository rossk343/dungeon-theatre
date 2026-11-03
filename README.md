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
2. Auth, games and invite codes
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

## Map images and grid
- Create a scene from the **New scene** panel (name plus a PNG, JPEG, WebP or GIF), or use **Replace map image** on an existing scene.
- Uploads are limited to 25 MB and 10000x10000 px. The server identifies the file type from its bytes (not the filename), stores it under `server/DungeonTheatre.Api/uploads/` with a random name and serves it at `/uploads/...`. That folder is git-ignored.
- **Grid** panel: set the square size and X/Y offset to match the map's printed squares. Changes preview live and are shared with everyone when you press **Save grid**.
- Token positions are stored in map pixels, so recalibrating the grid never moves tokens.

## Database changes
```
cd server/DungeonTheatre.Api
dotnet tool install --global dotnet-ef
dotnet ef migrations add <Name> -o Data/Migrations
```
Delete `dungeon-theatre.db` (and the `uploads` folder) to reset to the seed data.
