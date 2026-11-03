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
Vertical slice: grid canvas with a scene switcher, a game-wide token library (name, HP) and per-scene placements, all synced over SignalR. Tokens keep their properties across scenes; a scene only stores where each token sits. State is in memory.
