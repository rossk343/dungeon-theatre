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

## Status
Early planning. Nothing is scaffolded yet.
