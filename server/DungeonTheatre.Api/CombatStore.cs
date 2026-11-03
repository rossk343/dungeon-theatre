using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DungeonTheatre.Api;

public record InitiativeEntry(string TokenId, int Initiative);

// Entries are already in turn order (highest initiative first).
public record Combat(
    string SceneId, bool Active, int Round, string? CurrentTokenId, int MovedFeet, IReadOnlyList<InitiativeEntry> Entries);

// Combat is set when the move changed the movement used this turn.
public record MoveResult(Placement Placement, bool Accepted, string? Reason, Combat? Combat);

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
            encounter?.MovedFeet ?? 0, entries.Select(i => new InitiativeEntry(i.TokenId, i.Initiative)).ToList());
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
                (encounter.Active, encounter.CurrentTokenId, encounter.Round, encounter.MovedFeet) = (false, null, 0, 0);
            else if (encounter.CurrentTokenId == tokenId)
            {
                if (index >= entries.Count) encounter.Round++;
                encounter.CurrentTokenId = entries[index % entries.Count].TokenId;
                encounter.MovedFeet = 0;
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
            await db.SaveChangesAsync();
        }
        return await GetCombatAsync(sceneId);
    }

    public async Task<Combat?> EndCombatAsync(string sceneId)
    {
        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is null) return null;
        (encounter.Active, encounter.Round, encounter.CurrentTokenId, encounter.MovedFeet) = (false, 0, null, 0);
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
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    // GM override: gives the current token its full movement back.
    public async Task<Combat?> ResetMovementAsync(string sceneId)
    {
        var encounter = await db.Encounters.FindAsync(sceneId);
        if (encounter is not { Active: true }) return null;
        encounter.MovedFeet = 0;
        await db.SaveChangesAsync();
        return await GetCombatAsync(sceneId);
    }

    // Only the token whose turn it is has its movement counted; everything else moves freely.
    // Distance is in grid squares with diagonals costing the same as straight steps.
    public async Task<MoveResult?> CommitMoveAsync(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        var placement = await db.Placements.FindAsync(sceneId, tokenId);
        if (placement is null) return null;

        var encounter = await db.Encounters.FindAsync(sceneId);
        var metered = encounter is { Active: true } && encounter.CurrentTokenId == tokenId;
        var cost = 0;
        if (metered)
        {
            var scene = await db.Scenes.AsNoTracking().FirstAsync(s => s.Id == sceneId);
            var speed = await db.Tokens.AsNoTracking().Where(t => t.Id == tokenId).Select(t => t.SpeedFeet).FirstAsync();
            var squares = Math.Round(Math.Max(Math.Abs(x - placement.X), Math.Abs(y - placement.Y)) / scene.GridSize);
            var feet = squares * scene.FeetPerSquare;
            var left = Math.Max(0, speed - encounter!.MovedFeet);
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

    private static Placement ToDto(PlacementEntity p) => new(p.SceneId, p.TokenId, p.X, p.Y);
}
