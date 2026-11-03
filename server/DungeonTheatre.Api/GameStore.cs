using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DungeonTheatre.Api;

// Persistent identity; shared across every scene.
public record Token(string Id, string Name, string Color, int Hp, int MaxHp);

public record Scene(string Id, string Name, int Width, int Height, int GridSize);

// Where a token sits on one scene, in map pixel coordinates.
public record Placement(string SceneId, string TokenId, double X, double Y);

public record GameState(IReadOnlyList<Scene> Scenes, IReadOnlyList<Token> Tokens);

// Scoped: one DbContext per hub invocation.
public class GameStore(GameDbContext db)
{
    private static Placement ToDto(PlacementEntity p) => new(p.SceneId, p.TokenId, p.X, p.Y);

    private static Token ToDto(TokenEntity t) => new(t.Id, t.Name, t.Color, t.Hp, t.MaxHp);

    public async Task<GameState> GetStateAsync()
    {
        var scenes = await db.Scenes.AsNoTracking().OrderBy(s => s.Name)
            .Select(s => new Scene(s.Id, s.Name, s.Width, s.Height, s.GridSize)).ToListAsync();
        var tokens = await db.Tokens.AsNoTracking().OrderBy(t => t.Name)
            .Select(t => new Token(t.Id, t.Name, t.Color, t.Hp, t.MaxHp)).ToListAsync();
        return new GameState(scenes, tokens);
    }

    public Task<bool> SceneExistsAsync(string sceneId) => db.Scenes.AnyAsync(s => s.Id == sceneId);

    public async Task<List<Placement>> GetPlacementsAsync(string sceneId) =>
        await db.Placements.AsNoTracking().Where(p => p.SceneId == sceneId)
            .Select(p => new Placement(p.SceneId, p.TokenId, p.X, p.Y)).ToListAsync();

    // Adds the placement, or moves it if the token is already on the scene.
    public async Task<Placement?> SetPlacementAsync(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        if (!await db.Scenes.AnyAsync(s => s.Id == sceneId) || !await db.Tokens.AnyAsync(t => t.Id == tokenId))
            return null;

        var entity = await db.Placements.FindAsync(sceneId, tokenId);
        if (entity is null)
            db.Placements.Add(entity = new PlacementEntity { SceneId = sceneId, TokenId = tokenId, X = x, Y = y });
        else
            (entity.X, entity.Y) = (x, y);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public async Task<Placement?> MovePlacementAsync(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        var entity = await db.Placements.FindAsync(sceneId, tokenId);
        if (entity is null) return null;
        (entity.X, entity.Y) = (x, y);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public async Task<bool> RemovePlacementAsync(string sceneId, string tokenId) =>
        await db.Placements.Where(p => p.SceneId == sceneId && p.TokenId == tokenId).ExecuteDeleteAsync() > 0;

    public async Task<Token?> UpdateTokenAsync(string tokenId, string name, int hp)
    {
        name = name.Trim();
        if (name.Length is 0 or > 40) return null;
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return null;
        entity.Name = name;
        entity.Hp = Math.Clamp(hp, 0, entity.MaxHp);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }
}
