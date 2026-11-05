using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace DungeonTheatre.Api;

public record InitiativeEntry(string TokenId, int Initiative);

// Entries are already in turn order (highest initiative first).
public record Combat(
    string SceneId, bool Active, int Round, string? CurrentTokenId, int MovedFeet, IReadOnlyList<InitiativeEntry> Entries,
    double? TurnStartX, double? TurnStartY, bool Dashed);

// Combat is set when the move changed the movement used this turn.
public record MoveResult(Placement Placement, bool Accepted, string? Reason, Combat? Combat);

public record MovementResetResult(Placement Placement, Combat Combat);

// Scoped: one DbContext per hub invocation.
public class CombatStore(GameDbContext db)
{
    public const int MinInitiative = -100;
    public const int MaxInitiative = 1000;

    // Token id breaks ties so the order is stable when names change.
    private static List<InitiativeEntity> Ordered(IEnumerable<InitiativeEntity> entries) =>
        entries.OrderByDescending(e => e.Initiative).ThenBy(e => e.TokenId, StringComparer.Ordinal).ToList();

    public async Task<Combat> GetCombatAsync(string sceneId)
    {
        var encounter = await db.Encounters.AsNoTracking().FirstOrDefaultAsync(e => e.SceneId == sceneId);
        var entries = Ordered(await db.Initiative.AsNoTracking().Where(i => i.SceneId == sceneId).ToListAsync());
        return new Combat(sceneId, encounter?.Active ?? false, encounter?.Round ?? 0, encounter?.CurrentTokenId,
            encounter?.MovedFeet ?? 0, entries.Select(i => new InitiativeEntry(i.TokenId, i.Initiative)).ToList(),
            encounter?.TurnStartX, encounter?.TurnStartY, encounter?.Dashed ?? false);
    }

    // Only tokens that are on the scene can be in its initiative order.
    public async Task<Combat?> SetInitiativeAsync(string sceneId, string tokenId, int initiative)
    {
        if (initiative is < MinInitiative or > MaxInitiative) return null;
        if (!await db.Placements.AnyAsync(p => p.SceneId == sceneId && p.TokenId == tokenId)) return null;

        var entry = await db.Initiative.FindAsync(sceneId, tokenId);
        if (entry is null)
            db.Initiative.Add(new InitiativeEntity { SceneId = sceneId, TokenId = tokenId, Initiative = initiative });
        else
            entry.Initiative = initiative;
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    // If the removed token had the turn, it passes to whoever now sits in its slot.
    public async Task<Combat?> RemoveFromInitiativeAsync(string sceneId, string tokenId)
    {
        var entries = Ordered(await db.Initiative.Where(i => i.SceneId == sceneId).ToListAsync());
        var index = entries.FindIndex(i => i.TokenId == tokenId);
        if (index < 0) return null;

        db.Initiative.Remove(entries[index]);
        entries.RemoveAt(index);

        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is { Active: true })
        {
            if (entries.Count == 0)
            {
                (encounter.Active, encounter.CurrentTokenId, encounter.Round, encounter.MovedFeet) = (false, null, 0, 0);
                (encounter.TurnStartX, encounter.TurnStartY, encounter.Dashed) = (null, null, false);
            }
            else if (encounter.CurrentTokenId == tokenId)
            {
                if (index >= entries.Count) encounter.Round++;
                encounter.CurrentTokenId = entries[index % entries.Count].TokenId;
                encounter.MovedFeet = 0;
                encounter.Dashed = false;
                await SetTurnStartPositionAsync(encounter);
            }
        }
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    // Used before a token is deleted everywhere, so no scene is left pointing at a missing turn.
    public async Task<List<Combat>> RemoveTokenFromAllAsync(string tokenId)
    {
        var sceneIds = await db.Initiative.Where(i => i.TokenId == tokenId).Select(i => i.SceneId).ToListAsync();
        var changed = new List<Combat>();
        foreach (var sceneId in sceneIds)
            if (await RemoveFromInitiativeAsync(sceneId, tokenId) is { } combat) changed.Add(combat);
        return changed;
    }

    public async Task<Combat?> StartCombatAsync(string sceneId)
    {
        var entries = Ordered(await db.Initiative.Where(i => i.SceneId == sceneId).ToListAsync());
        if (entries.Count == 0) return null;

        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is null) db.Encounters.Add(encounter = new EncounterEntity { SceneId = sceneId });
        if (!encounter.Active)
        {
            (encounter.Active, encounter.Round, encounter.CurrentTokenId, encounter.MovedFeet) =
                (true, 1, entries[0].TokenId, 0);
            encounter.Dashed = false;
            await SetTurnStartPositionAsync(encounter);
            await db.SaveChangesAsync();
        }
        return await GetCombatAsync(sceneId);
    }

    public async Task<Combat?> EndCombatAsync(string sceneId)
    {
        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is null) return null;
        (encounter.Active, encounter.Round, encounter.CurrentTokenId, encounter.MovedFeet) = (false, 0, null, 0);
        (encounter.TurnStartX, encounter.TurnStartY, encounter.Dashed) = (null, null, false);
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    public async Task<Combat?> NextTurnAsync(string sceneId)
    {
        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is not { Active: true }) return null;
        var entries = Ordered(await db.Initiative.Where(i => i.SceneId == sceneId).ToListAsync());
        if (entries.Count == 0) return null;

        var index = entries.FindIndex(i => i.TokenId == encounter.CurrentTokenId);
        if (index >= 0 && index + 1 >= entries.Count) encounter.Round++;
        encounter.CurrentTokenId = entries[(index + 1) % entries.Count].TokenId;
        encounter.MovedFeet = 0;
        encounter.Dashed = false;
        await SetTurnStartPositionAsync(encounter);
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    // Dashing spends the turn's action, so it is refused once the token has dashed; attacks check Dashed too.
    public async Task<Combat?> DashAsync(string sceneId)
    {
        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is not { Active: true } || encounter.CurrentTokenId is null) return null;
        encounter.Dashed = true;
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    public async Task<bool> CurrentTurnDashedAsync(string sceneId) =>
        await db.Encounters.AsNoTracking().AnyAsync(e => e.SceneId == sceneId && e.Active && e.Dashed);

    // Resets the current token's position and movement to the start of its turn.
    public async Task<MovementResetResult?> ResetMovementAsync(string sceneId)
    {
        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is not { Active: true }) return null;
        var placement = await db.Placements.FindAsync(sceneId, encounter.CurrentTokenId);
        if (placement is null) return null;
        if (encounter.TurnStartX is not double startX || encounter.TurnStartY is not double startY)
        {
            startX = placement.X;
            startY = placement.Y;
            (encounter.TurnStartX, encounter.TurnStartY) = (startX, startY);
        }
        (placement.X, placement.Y) = (startX, startY);
        encounter.MovedFeet = 0;
        encounter.Dashed = false;
        await db.SaveChangesAsync();
        return new MovementResetResult(ToDto(placement), await GetCombatAsync(sceneId));
    }

    private async Task SetTurnStartPositionAsync(EncounterEntity encounter)
    {
        var placement = encounter.CurrentTokenId is null
            ? null
            : await db.Placements.AsNoTracking()
                .FirstOrDefaultAsync(p => p.SceneId == encounter.SceneId && p.TokenId == encounter.CurrentTokenId);
        if (placement is null)
            (encounter.TurnStartX, encounter.TurnStartY) = (null, null);
        else
            (encounter.TurnStartX, encounter.TurnStartY) = (placement.X, placement.Y);
    }

    // Players move player tokens; in combat only the token whose turn it is.
    public async Task<bool> PlayerCanMoveAsync(string sceneId, string tokenId)
    {
        if (!await db.Tokens.AsNoTracking().AnyAsync(t => t.Id == tokenId && t.IsPlayer)) return false;
        var encounter = await db.Encounters.AsNoTracking().FirstOrDefaultAsync(e => e.SceneId == sceneId);
        return encounter is not { Active: true } || encounter.CurrentTokenId == tokenId;
    }

    // Identifies one attacker's turn so a damage roll can only follow a hit made on that turn.
    public async Task<string?> GetTurnKeyAsync(string sceneId)
    {
        var encounter = await db.Encounters.AsNoTracking().FirstOrDefaultAsync(e => e.SceneId == sceneId);
        return encounter is { Active: true } ? $"{sceneId}:{encounter.Round}:{encounter.CurrentTokenId}" : null;
    }

    // An NPC in the scene's initiative order that can be attacked.
    public async Task<TokenEntity?> GetAttackTargetAsync(string sceneId, string targetTokenId)
    {
        var encounter = await db.Encounters.AsNoTracking().FirstOrDefaultAsync(e => e.SceneId == sceneId);
        if (encounter is not { Active: true }) return null;
        var inOrder = await db.Initiative.AsNoTracking()
            .AnyAsync(i => i.SceneId == sceneId && i.TokenId == targetTokenId);
        if (!inOrder) return null;
        return await db.Tokens.AsNoTracking().FirstOrDefaultAsync(t => t.Id == targetTokenId && !t.IsPlayer);
    }

    public async Task<bool> CurrentTurnIsPlayerAsync(string sceneId)
    {
        var encounter = await db.Encounters.AsNoTracking().FirstOrDefaultAsync(e => e.SceneId == sceneId);
        if (encounter is not { Active: true } || encounter.CurrentTokenId is null) return false;
        return await db.Tokens.AsNoTracking().AnyAsync(t => t.Id == encounter.CurrentTokenId && t.IsPlayer);
    }

    public async Task<Placement?> GetPlacementAsync(string sceneId, string tokenId) =>
        await db.Placements.AsNoTracking().Where(p => p.SceneId == sceneId && p.TokenId == tokenId)
            .Select(p => ToDto(p)).FirstOrDefaultAsync();

    // Only the token whose turn it is has its movement counted; everything else moves freely.
    // Distance is in grid squares with diagonals costing the same as straight steps.
    public async Task<MoveResult?> CommitMoveAsync(
        string sceneId, string tokenId, double x, double y, bool ignoreWalls = false)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        var placement = await db.Placements.FindAsync(sceneId, tokenId);
        if (placement is null) return null;

        if (!ignoreWalls)
        {
            var wallsJson = await db.Scenes.AsNoTracking().Where(s => s.Id == sceneId)
                .Select(s => s.WallsJson).FirstOrDefaultAsync();
            var walls = JsonSerializer.Deserialize<List<Wall>>(wallsJson ?? "[]") ?? [];
            if (walls.Any(w => SegmentsIntersect(placement.X, placement.Y, x, y, w.X1, w.Y1, w.X2, w.Y2)))
                return new MoveResult(ToDto(placement), false, "A wall blocks that move.", null);
        }

        var encounter = await db.Encounters.FindAsync(sceneId);
        var metered = encounter is { Active: true } && encounter.CurrentTokenId == tokenId;
        var cost = 0;
        if (metered)
        {
            var scene = await db.Scenes.AsNoTracking().FirstAsync(s => s.Id == sceneId);
            var speed = await db.Tokens.AsNoTracking().Where(t => t.Id == tokenId).Select(t => t.SpeedFeet).FirstAsync();
            var squares = Math.Round(Math.Max(Math.Abs(x - placement.X), Math.Abs(y - placement.Y)) / scene.GridSize);
            var feet = squares * scene.FeetPerSquare;
            var left = Math.Max(0, speed * (encounter!.Dashed ? 2 : 1) - encounter.MovedFeet);
            if (feet > left)
                return new MoveResult(ToDto(placement), false,
                    $"Not enough movement: that move costs {feet:0} ft and only {left} ft is left.", null);
            cost = (int)feet;
            encounter.MovedFeet += cost;
        }

        (placement.X, placement.Y) = (x, y);
        await db.SaveChangesAsync();
        return new MoveResult(ToDto(placement), true, null, cost > 0 ? await GetCombatAsync(sceneId) : null);
    }

    private static bool SegmentsIntersect(
        double ax, double ay, double bx, double by, double cx, double cy, double dx, double dy)
    {
        static double Cross(double ox, double oy, double px, double py, double qx, double qy) =>
            (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
        static bool OnSegment(double px, double py, double qx, double qy, double rx, double ry) =>
            Math.Min(px, qx) <= rx && rx <= Math.Max(px, qx) && Math.Min(py, qy) <= ry && ry <= Math.Max(py, qy);

        var d1 = Cross(cx, cy, dx, dy, ax, ay);
        var d2 = Cross(cx, cy, dx, dy, bx, by);
        var d3 = Cross(ax, ay, bx, by, cx, cy);
        var d4 = Cross(ax, ay, bx, by, dx, dy);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        // Touching or collinear cases count as blocked so a token can't slip along a wall's end.
        return (d1 == 0 && OnSegment(cx, cy, dx, dy, ax, ay)) || (d2 == 0 && OnSegment(cx, cy, dx, dy, bx, by)) ||
               (d3 == 0 && OnSegment(ax, ay, bx, by, cx, cy)) || (d4 == 0 && OnSegment(ax, ay, bx, by, dx, dy));
    }

    private static Placement ToDto(PlacementEntity p) => new(p.SceneId, p.TokenId, p.X, p.Y);
}
