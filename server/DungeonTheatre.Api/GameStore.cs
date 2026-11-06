using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace DungeonTheatre.Api;

// Persistent identity; shared across every scene.
public record Token(string Id, string Name, string Color, int Hp, int MaxHp, int SpeedFeet, int? ArmorClass,
    int VisionFeet, int LightFeet, bool IsPlayer, string? ImageUrl)
{
    public Token ForPlayerView() => IsPlayer ? this : this with { ArmorClass = null };
}

public record Chapter(string Id, string Name, int SortOrder);

public record Scene(
    string Id, string ChapterId, string Name, int SortOrder, int Width, int Height, int GridSize,
    int GridOffsetX, int GridOffsetY, int FeetPerSquare,     string? ImageUrl, IReadOnlyList<FogArea> FogAreas,
        IReadOnlyList<Wall> Walls, bool LightingEnabled);

    public record FogPoint(double X, double Y);
    public record FogArea(string Id, IReadOnlyList<FogPoint> Points);

    // A straight wall segment that blocks player vision and movement.
    public record Wall(string Id, double X1, double Y1, double X2, double Y2);

// Where a token sits on one scene, in map pixel coordinates.
public record Placement(string SceneId, string TokenId, double X, double Y);

public record GameState(
    string GameName, IReadOnlyList<Chapter> Chapters, IReadOnlyList<Scene> Scenes, IReadOnlyList<Token> Tokens,
    string? ActiveSceneId);

// Scoped: one DbContext per hub invocation.
public class GameStore(GameDbContext db)
{
    // One game until accounts exist; every query is already scoped through it.
    public const string DefaultGameId = "default";

    private const int DefaultGridSize = 70;
    private const int MinGridSize = 10;
    private const int MaxGridSize = 500;

    private static Placement ToDto(PlacementEntity p) => new(p.SceneId, p.TokenId, p.X, p.Y);

    private const int MaxSpeedFeet = 999;

    public static bool IsValidSpeed(int speed) => speed is >= 0 and <= MaxSpeedFeet;
    public static bool IsValidArmorClass(int armorClass) => armorClass is >= 0 and <= 99;

    private static Token ToDto(TokenEntity t) =>
        new(t.Id, t.Name, t.Color, t.Hp, t.MaxHp, t.SpeedFeet, t.ArmorClass, t.VisionFeet, t.LightFeet,
            t.IsPlayer, t.ImageUrl);

    private static Chapter ToDto(ChapterEntity c) => new(c.Id, c.Name, c.SortOrder);

    private static Scene ToDto(SceneEntity s) =>
        new(s.Id, s.ChapterId, s.Name, s.SortOrder, s.Width, s.Height, s.GridSize, s.GridOffsetX, s.GridOffsetY,
            s.FeetPerSquare, s.ImageUrl, JsonSerializer.Deserialize<List<FogArea>>(s.FogAreasJson) ?? [],
            JsonSerializer.Deserialize<List<Wall>>(s.WallsJson) ?? [], s.LightingEnabled);

    public async Task<GameState> GetStateAsync()
    {
        var game = await db.Games.AsNoTracking().FirstOrDefaultAsync(g => g.Id == DefaultGameId);
        var chapters = await db.Chapters.AsNoTracking().Where(c => c.GameId == DefaultGameId)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync();
        var scenes = await db.Scenes.AsNoTracking()
            .Where(s => db.Chapters.Any(c => c.Id == s.ChapterId && c.GameId == DefaultGameId))
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Name).ToListAsync();
        var tokens = await db.Tokens.AsNoTracking().Where(t => t.GameId == DefaultGameId).OrderBy(t => t.Name).ToListAsync();
        var firstSceneId = chapters.SelectMany(c => scenes.Where(s => s.ChapterId == c.Id)).FirstOrDefault()?.Id;
        var activeSceneId = game?.ActiveSceneId is { } storedId && scenes.Any(s => s.Id == storedId)
            ? storedId
            : firstSceneId;
        return new GameState(game?.Name ?? "", chapters.Select(ToDto).ToList(), scenes.Select(ToDto).ToList(),
            tokens.Select(ToDto).ToList(), activeSceneId);
    }

    public async Task<string?> GetActiveSceneIdAsync()
    {
        var state = await GetStateAsync();
        return state.ActiveSceneId;
    }

    public async Task<string?> SetActiveSceneAsync(string sceneId)
    {
        if (!await SceneExistsAsync(sceneId)) return null;
        var game = await db.Games.FirstOrDefaultAsync(g => g.Id == DefaultGameId);
        if (game is null) return null;
        game.ActiveSceneId = sceneId;
        await db.SaveChangesAsync();
        return sceneId;
    }

    public Task<bool> ChapterExistsAsync(string chapterId) =>
        db.Chapters.AnyAsync(c => c.Id == chapterId && c.GameId == DefaultGameId);

    public async Task<Chapter?> CreateChapterAsync(string name)
    {
        name = name.Trim();
        if (!IsValidName(name, 100)) return null;
        var next = await db.Chapters.Where(c => c.GameId == DefaultGameId).MaxAsync(c => (int?)c.SortOrder) ?? -1;
        var entity = new ChapterEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            GameId = DefaultGameId,
            Name = name,
            SortOrder = next + 1,
        };
        db.Chapters.Add(entity);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public async Task<Chapter?> RenameChapterAsync(string chapterId, string name)
    {
        name = name.Trim();
        if (!IsValidName(name, 100)) return null;
        var entity = await db.Chapters.FirstOrDefaultAsync(c => c.Id == chapterId && c.GameId == DefaultGameId);
        if (entity is null) return null;
        entity.Name = name;
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public enum DeleteChapterResult { Deleted, NotFound, NotEmpty }

    public async Task<DeleteChapterResult> DeleteChapterAsync(string chapterId)
    {
        var entity = await db.Chapters.FirstOrDefaultAsync(c => c.Id == chapterId && c.GameId == DefaultGameId);
        if (entity is null) return DeleteChapterResult.NotFound;
        if (await db.Scenes.AnyAsync(s => s.ChapterId == chapterId)) return DeleteChapterResult.NotEmpty;
        db.Chapters.Remove(entity);
        await db.SaveChangesAsync();
        return DeleteChapterResult.Deleted;
    }

    // Moves a scene to the end of another chapter.
    public async Task<Scene?> MoveSceneAsync(string sceneId, string chapterId)
    {
        if (!await ChapterExistsAsync(chapterId)) return null;
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return null;
        if (entity.ChapterId != chapterId)
        {
            var next = await db.Scenes.Where(s => s.ChapterId == chapterId).MaxAsync(s => (int?)s.SortOrder) ?? -1;
            (entity.ChapterId, entity.SortOrder) = (chapterId, next + 1);
            await db.SaveChangesAsync();
        }
        return ToDto(entity);
    }

    public async Task<Scene?> CreateSceneAsync(string chapterId, string name, string imageUrl, int width, int height)
    {
        if (!await ChapterExistsAsync(chapterId)) return null;
        var next = await db.Scenes.Where(s => s.ChapterId == chapterId).MaxAsync(s => (int?)s.SortOrder) ?? -1;
        var entity = new SceneEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            ChapterId = chapterId,
            SortOrder = next + 1,
            Name = name,
            Width = width,
            Height = height,
            GridSize = DefaultGridSize,
            ImageUrl = imageUrl,
        };
        db.Scenes.Add(entity);
        await db.SaveChangesAsync();
        var game = await db.Games.FirstOrDefaultAsync(g => g.Id == DefaultGameId);
        if (game is not null && game.ActiveSceneId is null)
        {
            game.ActiveSceneId = entity.Id;
            await db.SaveChangesAsync();
        }
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

    public async Task<Scene?> UpdateSceneFogAsync(string sceneId, IReadOnlyList<FogArea>? fogAreas)
    {
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null || fogAreas is null || fogAreas.Count > 25) return null;
        if (fogAreas.Any(area =>
                area is null || area.Points is null ||
                string.IsNullOrWhiteSpace(area.Id) || area.Id.Length > 64 ||
                area.Points.Count is < 3 or > 100 ||
                area.Points.Any(point =>
                    !double.IsFinite(point.X) || !double.IsFinite(point.Y) ||
                    point.X < 0 || point.X > entity.Width || point.Y < 0 || point.Y > entity.Height)) ||
            fogAreas.Select(area => area.Id).Distinct(StringComparer.Ordinal).Count() != fogAreas.Count)
            return null;

        entity.FogAreasJson = JsonSerializer.Serialize(fogAreas);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public async Task<Scene?> UpdateSceneWallsAsync(string sceneId, IReadOnlyList<Wall>? walls)
    {
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null || walls is null || walls.Count > 500) return null;
        if (walls.Any(wall =>
                wall is null ||
                string.IsNullOrWhiteSpace(wall.Id) || wall.Id.Length > 64 ||
                !double.IsFinite(wall.X1) || !double.IsFinite(wall.Y1) ||
                !double.IsFinite(wall.X2) || !double.IsFinite(wall.Y2) ||
                wall.X1 < 0 || wall.X1 > entity.Width || wall.X2 < 0 || wall.X2 > entity.Width ||
                wall.Y1 < 0 || wall.Y1 > entity.Height || wall.Y2 < 0 || wall.Y2 > entity.Height ||
                (wall.X1 == wall.X2 && wall.Y1 == wall.Y2)) ||
            walls.Select(wall => wall.Id).Distinct(StringComparer.Ordinal).Count() != walls.Count)
            return null;

        entity.WallsJson = JsonSerializer.Serialize(walls);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public async Task<Scene?> UpdateSceneLightingAsync(string sceneId, bool enabled)
    {
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return null;
        entity.LightingEnabled = enabled;
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public Task<bool> SceneExistsAsync(string sceneId) => db.Scenes.AnyAsync(s => s.Id == sceneId);

    public async Task<List<Placement>> GetPlacementsAsync(string sceneId) =>
        await db.Placements.AsNoTracking().Where(p => p.SceneId == sceneId)
            .Select(p => new Placement(p.SceneId, p.TokenId, p.X, p.Y)).ToListAsync();

    // Adds the placement; an existing one is returned untouched so this can't bypass movement limits.
    public async Task<Placement?> SetPlacementAsync(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        if (!await db.Scenes.AnyAsync(s => s.Id == sceneId) || !await db.Tokens.AnyAsync(t => t.Id == tokenId))
            return null;

        var entity = await db.Placements.FindAsync(sceneId, tokenId);
        if (entity is null)
        {
            db.Placements.Add(entity = new PlacementEntity { SceneId = sceneId, TokenId = tokenId, X = x, Y = y });
            await db.SaveChangesAsync();
        }
        return ToDto(entity);
    }
    public async Task<bool> RemovePlacementAsync(string sceneId, string tokenId) =>
        await db.Placements.Where(p => p.SceneId == sceneId && p.TokenId == tokenId).ExecuteDeleteAsync() > 0;

    public record TokenHealthUpdate(Token Token, bool FoeSlain);

    public async Task<TokenHealthUpdate?> UpdateTokenAsync(string tokenId, string name, int hp, int speedFeet, int armorClass)
    {
        name = name.Trim();
        if (name.Length is 0 or > 40 || !IsValidSpeed(speedFeet) || !IsValidArmorClass(armorClass)) return null;
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return null;
        var wasAlive = entity.Hp > 0;
        entity.Name = name;
        entity.Hp = Math.Clamp(hp, 0, entity.MaxHp);
        entity.SpeedFeet = speedFeet;
        entity.ArmorClass = armorClass;
        await db.SaveChangesAsync();
        return new TokenHealthUpdate(ToDto(entity), !entity.IsPlayer && wasAlive && entity.Hp == 0);
    }

    public async Task<TokenHealthUpdate?> ApplyDamageAsync(string tokenId, int amount)
    {
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return null;
        var wasAlive = entity.Hp > 0;
        entity.Hp = Math.Clamp(entity.Hp - Math.Max(0, amount), 0, entity.MaxHp);
        await db.SaveChangesAsync();
        return new TokenHealthUpdate(ToDto(entity), !entity.IsPlayer && wasAlive && entity.Hp == 0);
    }

    public async Task<Token?> UpdateTokenLightingAsync(string tokenId, int visionFeet, int lightFeet)
    {
        if (!IsValidLightRange(visionFeet) || !IsValidLightRange(lightFeet)) return null;
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return null;
        entity.VisionFeet = visionFeet;
        entity.LightFeet = lightFeet;
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
    public async Task<(bool Found, string? ImageUrl, string? ActiveSceneId)> DeleteSceneAsync(string sceneId)
    {
        var entity = await db.Scenes.FindAsync(sceneId);
        if (entity is null) return (false, null, null);
        var game = await db.Games.FirstOrDefaultAsync(g => g.Id == DefaultGameId);
        var wasActive = game?.ActiveSceneId == sceneId;
        db.Scenes.Remove(entity);
        await db.SaveChangesAsync();
        if (wasActive && game is not null)
        {
            var state = await GetStateAsync();
            game.ActiveSceneId = state.ActiveSceneId;
            await db.SaveChangesAsync();
        }
        return (true, entity.ImageUrl, await GetActiveSceneIdAsync());
    }

    public async Task<Token?> CreateTokenAsync(string name, string color, int maxHp, int speedFeet, int armorClass,
        int visionFeet, int lightFeet, bool isPlayer, string? imageUrl)
    {
        name = name.Trim();
        if (!IsValidName(name, 40) || !IsValidColor(color) || maxHp is < 1 or > 9999 ||
            !IsValidSpeed(speedFeet) || !IsValidArmorClass(armorClass) ||
            !IsValidLightRange(visionFeet) || !IsValidLightRange(lightFeet))
            return null;
        var entity = new TokenEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            GameId = DefaultGameId,
            Name = name,
            Color = color,
            Hp = maxHp,
            MaxHp = maxHp,
            SpeedFeet = speedFeet,
            ArmorClass = armorClass,
            VisionFeet = visionFeet,
            LightFeet = lightFeet,
            IsPlayer = isPlayer,
            ImageUrl = imageUrl,
        };
        db.Tokens.Add(entity);
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public Task<bool> IsPlayerTokenAsync(string tokenId) =>
        db.Tokens.AsNoTracking().AnyAsync(t => t.Id == tokenId && t.IsPlayer);

    public async Task<Token?> SetTokenKindAsync(string tokenId, bool isPlayer)
    {
        var entity = await db.Tokens.FindAsync(tokenId);
        if (entity is null) return null;
        entity.IsPlayer = isPlayer;
        await db.SaveChangesAsync();
        return ToDto(entity);
    }

    public static bool IsValidColor(string? color) =>
        color is { Length: 7 } && color[0] == '#' && color.Skip(1).All(Uri.IsHexDigit);

    public static bool IsValidLightRange(int rangeFeet) => rangeFeet is >= 0 and <= 999;

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
