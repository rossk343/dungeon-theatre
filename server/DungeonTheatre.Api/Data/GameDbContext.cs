using Microsoft.EntityFrameworkCore;

namespace DungeonTheatre.Api.Data;

public class TokenEntity
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Color { get; set; }
    public int Hp { get; set; }
    public int MaxHp { get; set; }
    public string? ImageUrl { get; set; }
}

public class SceneEntity
{
    public required string Id { get; set; }
    public required string Name { get; set; }
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
    public DbSet<TokenEntity> Tokens => Set<TokenEntity>();
    public DbSet<SceneEntity> Scenes => Set<SceneEntity>();
    public DbSet<PlacementEntity> Placements => Set<PlacementEntity>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TokenEntity>(e =>
        {
            e.HasKey(t => t.Id);
            e.Property(t => t.Name).HasMaxLength(40);
        });
        b.Entity<SceneEntity>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Name).HasMaxLength(100);
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
        db.Scenes.AddRange(
            new SceneEntity { Id = "crypt", Name = "The Sunken Crypt", Width = 1200, Height = 720, GridSize = 60 },
            new SceneEntity { Id = "bridge", Name = "Bridge of Sighs", Width = 1200, Height = 720, GridSize = 80 });
        db.Tokens.AddRange(
            new TokenEntity { Id = "t1", Name = "Knight", Color = "#b23a48", Hp = 34, MaxHp = 34 },
            new TokenEntity { Id = "t2", Name = "Rogue", Color = "#3a7ca5", Hp = 22, MaxHp = 22 },
            new TokenEntity { Id = "t3", Name = "Wraith", Color = "#6b5b95", Hp = 45, MaxHp = 45 });
        db.Placements.AddRange(
            new PlacementEntity { SceneId = "crypt", TokenId = "t1", X = 150, Y = 150 },
            new PlacementEntity { SceneId = "crypt", TokenId = "t2", X = 270, Y = 150 },
            new PlacementEntity { SceneId = "crypt", TokenId = "t3", X = 390, Y = 270 },
            new PlacementEntity { SceneId = "bridge", TokenId = "t1", X = 120, Y = 120 },
            new PlacementEntity { SceneId = "bridge", TokenId = "t2", X = 200, Y = 120 });
        await db.SaveChangesAsync();
    }
}
