using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DungeonTheatre.Api;

// Persistent identity; shared across every scene.
public record Token(string Id, string Name, string Color, int Hp, int MaxHp, string? ImageUrl);

public record Scene(
    string Id, string Name, int Width, int Height, int GridSize, int GridOffsetX, int GridOffsetY, string? ImageUrl);

// Where a token sits on one scene, in map pixel coordinates.
public record Placement(string SceneId, string TokenId, double X, double Y);

public record GameState(IReadOnlyList<Scene> Scenes, IReadOnlyList<Token> Tokens);

// Scoped: one DbContext per hub invocation.
public class GameStore(GameDbContext db)
{
    private const int DefaultGridSize = 70;
    private const int MinGridSize = 10;
    private const int MaxGridSize = 500;

    private static Placement ToDto(PlacementEntity p) => new(p.SceneId, p.TokenId, p.X, p.Y);

    private static Token ToDto(TokenEntity t) => new(t.Id, t.Name, t.Color, t.Hp, t.MaxHp, t.ImageUrl);

    private static Scene ToDto(SceneEntity s) =>
        new(s.Id, s.Name, s.Width, s.Height, s.GridSize, s.GridOffsetX, s.GridOffsetY, s.ImageUrl);

    public async Task<GameState> GetStateAsync()
    {
        var scenes = await db.Scenes.AsNoTracking().OrderBy(s => s.Name).ToListAsync();
        var tokens = await db.Tokens.AsNoTracking().OrderBy(t => t.Name).ToListAsync();
        return new GameState(scenes.Select(ToDto).ToList(), tokens.Select(ToDto).ToList());
    }

    public async Task<Scene> CreateSceneAsync(string name, string imageUrl, int width, int height)
    {
        var entity = new SceneEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = name,
            Width = width,
            Height = height,
            GridSize = DefaultGridSize,
            ImageUrl = imageUrl,
        };
        db.Scenes.Add(entity);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    // Positions stay in map pixels, so existing placements are untouched by a new image.
    public async Task<(Scene Scene, string? OldImageUrl)?> SetSceneImageAsync(
        string sceneId, string imageUrl, int width, int height)
    {
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return null;
        var old = entity.ImageUrl;
        (entity.ImageUrl, entity.Width, entity.Height) = (imageUrl, width, height);
        await db.SaveChangesAsync();
        return (ToDto(entity), old);
    }

    public async Task<Scene?> UpdateSceneGridAsync(string sceneId, int gridSize, int offsetX, int offsetY)
    {
        if (gridSize is < MinGridSize or > MaxGridSize) return null;
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return null;
        entity.GridSize = gridSize;
        entity.GridOffsetX = ((offsetX % gridSize) + gridSize) % gridSize;
        entity.GridOffsetY = ((offsetY % gridSize) + gridSize) % gridSize;
        await db.SaveChangesAsync();
        return ToDto(entity);
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

    public static bool IsValidName(string? name, int max) => !string.IsNullOrWhiteSpace(name) && name.Trim().Length <= max;

    public async Task<Scene?> RenameSceneAsync(string sceneId, string name)
    {
        name = name.Trim();
        if (!IsValidName(name, 100)) return null;
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return null;
        entity.Name = name;
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    // Placements go with the scene (cascade); tokens are untouched.
    public async Task<(bool Found, string? ImageUrl)> DeleteSceneAsync(string sceneId)
    {
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return (false, null);
        db.Scenes.Remove(entity);
        await db.SaveChangesAsync();
        return (true, entity.ImageUrl);
    }

    public async Task<Token?> CreateTokenAsync(string name, string color, int maxHp, string? imageUrl)
    {
        name = name.Trim();
        if (!IsValidName(name, 40) || !IsValidColor(color) || maxHp is < 1 or > 9999) return null;
        var entity = new TokenEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = name,
            Color = color,
            Hp = maxHp,
            MaxHp = maxHp,
            ImageUrl = imageUrl,
        };
        db.Tokens.Add(entity);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public static bool IsValidColor(string? color) =>
        color is { Length: 7 } && color[0] == '#' && color.Skip(1).All(Uri.IsHexDigit);

    public async Task<(Token Token, string? OldImageUrl)?> SetTokenImageAsync(string tokenId, string imageUrl)
    {
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return null;
        var old = entity.ImageUrl;
        entity.ImageUrl = imageUrl;
        await db.SaveChangesAsync();
        return (ToDto(entity), old);
    }

    // Placements go with the token (cascade) on every scene.
    public async Task<(bool Found, string? ImageUrl)> DeleteTokenAsync(string tokenId)
    {
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return (false, null);
        db.Tokens.Remove(entity);
        await db.SaveChangesAsync();
        return (true, entity.ImageUrl);
    }
}
