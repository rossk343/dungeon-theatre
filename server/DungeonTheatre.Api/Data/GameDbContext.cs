using Microsoft.EntityFrameworkCore;

namespace DungeonTheatre.Api.Data;

public class GameEntity
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    // Shared secret that lets people register or join as guests.
    public string InviteCode { get; set; } = "";
    public string? ActiveSceneId { get; set; }
}

public static class Roles
{
    public const string Gm = "gm";
    public const string Player = "player";
}

// Guests have no username or password; they hold a long-lived cookie instead.
public class UserEntity
{
    public required string Id { get; set; }
    public required string GameId { get; set; }
    public string? Username { get; set; }
    public required string DisplayName { get; set; }
    public string? PasswordHash { get; set; }
    public required string Role { get; set; }
    public bool IsGuest { get; set; }
}

public class ChapterEntity
{
    public required string Id { get; set; }
    public required string GameId { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
}

public class TokenEntity
{
    public required string Id { get; set; }
    public required string GameId { get; set; }
    public required string Name { get; set; }
    public required string Color { get; set; }
    public int Hp { get; set; }
    public int MaxHp { get; set; }
    public int SpeedFeet { get; set; } = 30;
    // Player tokens can be edited and moved by any player; the rest belong to the GM.
    public bool IsPlayer { get; set; }
    public string? ImageUrl { get; set; }
}

// One row per scene that has ever had combat; the order itself lives in InitiativeEntity.
public class EncounterEntity
{
    public required string SceneId { get; set; }
    public bool Active { get; set; }
    public int Round { get; set; }
    public string? CurrentTokenId { get; set; }
    // Feet the current token has already moved this turn.
    public int MovedFeet { get; set; }
}

public class InitiativeEntity
{
    public required string SceneId { get; set; }
    public required string TokenId { get; set; }
    public int Initiative { get; set; }
}

public class SceneEntity
{
    public required string Id { get; set; }
    public required string ChapterId { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public int FeetPerSquare { get; set; } = 5;
    public int Width { get; set; }
    public int Height { get; set; }
    public int GridSize { get; set; }
    public int GridOffsetX { get; set; }
    public int GridOffsetY { get; set; }
    public string? ImageUrl { get; set; }
}

// Composite key: a token appears at most once per scene.
public class PlacementEntity
{
    public required string SceneId { get; set; }
    public required string TokenId { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
}

public class GameDbContext(DbContextOptions<GameDbContext> options) : DbContext(options)
{
    public DbSet<GameEntity> Games => Set<GameEntity>();
    public DbSet<ChapterEntity> Chapters => Set<ChapterEntity>();
    public DbSet<TokenEntity> Tokens => Set<TokenEntity>();
    public DbSet<UserEntity> Users => Set<UserEntity>();
    public DbSet<SceneEntity> Scenes => Set<SceneEntity>();
    public DbSet<PlacementEntity> Placements => Set<PlacementEntity>();
    public DbSet<EncounterEntity> Encounters => Set<EncounterEntity>();
    public DbSet<InitiativeEntity> Initiative => Set<InitiativeEntity>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<GameEntity>(e =>
        {
            e.HasKey(g => g.Id);
            e.Property(g => g.Name).HasMaxLength(100);
        });
        b.Entity<UserEntity>(e =>
        {
            e.HasKey(u => u.Id);
            e.Property(u => u.Username).HasMaxLength(32);
            e.Property(u => u.DisplayName).HasMaxLength(40);
            e.HasIndex(u => u.Username).IsUnique();
            e.HasOne<GameEntity>().WithMany().HasForeignKey(u => u.GameId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<ChapterEntity>(e =>
        {
            e.HasKey(c => c.Id);
            e.Property(c => c.Name).HasMaxLength(100);
            e.HasOne<GameEntity>().WithMany().HasForeignKey(c => c.GameId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<TokenEntity>(e =>
        {
            e.HasKey(t => t.Id);
            e.Property(t => t.Name).HasMaxLength(40);
            e.HasOne<GameEntity>().WithMany().HasForeignKey(t => t.GameId).OnDelete(DeleteBehavior.Cascade);
        });
        // Restrict: a chapter must be emptied first so scene images are cleaned up by the app.
        b.Entity<SceneEntity>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Name).HasMaxLength(100);
            e.HasOne<ChapterEntity>().WithMany().HasForeignKey(s => s.ChapterId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<EncounterEntity>(e =>
        {
            e.HasKey(x => x.SceneId);
            e.HasOne<SceneEntity>().WithMany().HasForeignKey(x => x.SceneId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<InitiativeEntity>(e =>
        {
            e.HasKey(x => new { x.SceneId, x.TokenId });
            e.HasOne<SceneEntity>().WithMany().HasForeignKey(x => x.SceneId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TokenEntity>().WithMany().HasForeignKey(x => x.TokenId).OnDelete(DeleteBehavior.Cascade);
        });
        // Deleting a scene or a token removes its placements, never the other side.
        b.Entity<PlacementEntity>(e =>
        {
            e.HasKey(p => new { p.SceneId, p.TokenId });
            e.HasOne<SceneEntity>().WithMany().HasForeignKey(p => p.SceneId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TokenEntity>().WithMany().HasForeignKey(p => p.TokenId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public static class SeedData
{
    public static async Task SeedAsync(GameDbContext db)
    {
        const string game = GameStore.DefaultGameId;
        if (await db.Games.FindAsync(game) is null)
            db.Games.Add(new GameEntity
            {
                Id = game, Name = "My Campaign", InviteCode = AuthStore.NewInviteCode(), ActiveSceneId = "crypt",
            });
        if (await db.Chapters.FindAsync("chapter-1") is null)
            db.Chapters.Add(new ChapterEntity { Id = "chapter-1", GameId = game, Name = "Chapter 1" });
        await db.SaveChangesAsync();
        if (await db.Tokens.AnyAsync()) return;

        db.Scenes.AddRange(
            new SceneEntity { Id = "crypt", ChapterId = "chapter-1", SortOrder = 0, Name = "The Sunken Crypt", Width = 1200, Height = 720, GridSize = 60 },
            new SceneEntity { Id = "bridge", ChapterId = "chapter-1", SortOrder = 1, Name = "Bridge of Sighs", Width = 1200, Height = 720, GridSize = 80 });
        db.Tokens.AddRange(
            new TokenEntity { Id = "t1", GameId = game,             Name = "Knight", Color = "#b23a48", Hp = 34, MaxHp = 34, IsPlayer = true },
                        new TokenEntity { Id = "t2", GameId = game, Name = "Rogue", Color = "#3a7ca5", Hp = 22, MaxHp = 22, IsPlayer = true },
            new TokenEntity { Id = "t3", GameId = game, Name = "Wraith", Color = "#6b5b95", Hp = 45, MaxHp = 45 });
        db.Placements.AddRange(
            new PlacementEntity { SceneId = "crypt", TokenId = "t1", X = 150, Y = 150 },
            new PlacementEntity { SceneId = "crypt", TokenId = "t2", X = 270, Y = 150 },
            new PlacementEntity { SceneId = "crypt", TokenId = "t3", X = 390, Y = 270 },
            new PlacementEntity { SceneId = "bridge", TokenId = "t1", X = 120, Y = 120 },
            new PlacementEntity { SceneId = "bridge", TokenId = "t2", X = 200, Y = 120 });
        await db.SaveChangesAsync();
    }
}
