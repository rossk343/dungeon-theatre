using DungeonTheatre.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Cryptography;

namespace DungeonTheatre.Api;

// Every method re-checks the caller's role: hiding buttons in the client is not a security boundary.
[Authorize]
public class GameHub(GameStore store, CombatStore combats) : Hub
{
    private const string SceneKey = "scene";

    public static string Group(string sceneId) => $"scene:{sceneId}";
    public const string GmGroup = "role:gm";
    public const string PlayerGroup = "role:player";

    private bool IsGm => Context.User?.IsInRole(Roles.Gm) == true;

    public override async Task OnConnectedAsync()
    {
        var roleGroup = IsGm ? GmGroup : PlayerGroup;
        await Groups.AddToGroupAsync(Context.ConnectionId, roleGroup);
        await base.OnConnectedAsync();
    }

    private void RequireGm()
    {
        if (!IsGm) throw new HubException("Only the GM can do that.");
    }

    public Task<Combat> GetCombat(string sceneId) => combats.GetCombatAsync(sceneId);

    private Task Publish(Combat? combat) =>
        combat is null ? Task.CompletedTask : Clients.Group(Group(combat.SceneId)).SendAsync("CombatUpdated", combat);

    public async Task SetInitiative(string sceneId, string tokenId, int initiative)
    {
        RequireGm();
        await Publish(await combats.SetInitiativeAsync(sceneId, tokenId, initiative));
    }

    public async Task RemoveInitiative(string sceneId, string tokenId)
    {
        RequireGm();
        await Publish(await combats.RemoveFromInitiativeAsync(sceneId, tokenId));
    }

    public async Task StartCombat(string sceneId)
    {
        RequireGm();
        await Publish(await combats.StartCombatAsync(sceneId));
    }

    public async Task EndCombat(string sceneId)
    {
        RequireGm();
        await Publish(await combats.EndCombatAsync(sceneId));
    }

    // Players may end the turn of a player token, so the table isn't waiting on the GM.
    public async Task NextTurn(string sceneId)
    {
        if (!IsGm && !await combats.CurrentTurnIsPlayerAsync(sceneId))
            throw new HubException("Only the GM can end an enemy turn.");
        await Publish(await combats.NextTurnAsync(sceneId));
    }

    public async Task<MovementResetResult?> ResetMovement(string sceneId)
    {
        if (!IsGm &&
            (sceneId != await store.GetActiveSceneIdAsync() || !await combats.CurrentTurnIsPlayerAsync(sceneId)))
            throw new HubException("Only the current player token can reset its movement.");
        var result = await combats.ResetMovementAsync(sceneId);
        if (result is null) return null;
        await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", result.Placement);
        await Publish(result.Combat);
        return result;
    }

    // Optionally compares the total to an NPC's AC; the AC itself is never sent to clients.
    public async Task<DiceRoll> RollDice(
        IReadOnlyList<DiceGroupRequest>? groups, int modifier, string? sceneId = null, string? targetTokenId = null)
    {
        if (groups is null || groups.Count is < 1 or > 10 || modifier is < -999 or > 999 ||
            groups.Any(g => g is null || g.Sides is not (4 or 6 or 8 or 10 or 12 or 20 or 100) || g.Count is < 1 or > 20))
            throw new HubException("Choose 1-10 rows of standard dice (1-20 each) and a modifier between -999 and 999.");

        TokenEntity? target = null;
        if (!string.IsNullOrEmpty(targetTokenId))
        {
            if (string.IsNullOrEmpty(sceneId)) throw new HubException("Choose a scene to attack in.");
            if (!IsGm && sceneId != await store.GetActiveSceneIdAsync())
                throw new HubException("You can only attack in the active scene.");
            if (!IsGm && !await combats.CurrentTurnIsPlayerAsync(sceneId))
                throw new HubException("You can only attack on a player's turn.");
            target = await combats.GetAttackTargetAsync(sceneId, targetTokenId)
                ?? throw new HubException("Choose an NPC in the initiative order to attack.");
        }

        var rolled = groups
            .Select(g => new DiceGroupResult(
                g.Count,
                g.Sides,
                Enumerable.Range(0, g.Count).Select(_ => RandomNumberGenerator.GetInt32(g.Sides) + 1).ToArray()))
            .ToList();
        var total = rolled.Sum(g => g.Rolls.Sum()) + modifier;
        var result = new DiceRoll(
            Context.User?.Identity?.Name ?? "A player",
            rolled,
            modifier,
            total,
            target?.Name,
            target is null ? null : total >= target.ArmorClass);
        await Clients.All.SendAsync("DiceRolled", result);
        return result;
    }

    public async Task<GameState> GetState()
    {
        var state = await store.GetStateAsync();
        return IsGm
            ? state
            : state with { Tokens = state.Tokens.Select(token => token.ForPlayerView()).ToList() };
    }

    public record DiceGroupRequest(int Count, int Sides);
    public record DiceGroupResult(int Count, int Sides, IReadOnlyList<int> Rolls);
    public record DiceRoll(
        string Roller, IReadOnlyList<DiceGroupResult> Groups, int Modifier, int Total, string? Target, bool? Hit);

    public async Task<string?> SetActiveScene(string sceneId, double centerX, double centerY, double zoom)
    {
        RequireGm();
        if (!double.IsFinite(centerX) || !double.IsFinite(centerY) || !double.IsFinite(zoom) || zoom <= 0)
            throw new HubException("The shared map view is invalid.");
        var activeSceneId = await store.SetActiveSceneAsync(sceneId);
        if (activeSceneId is not null)
            await Clients.All.SendAsync("ActiveSceneChanged", activeSceneId, new { centerX, centerY, zoom });
        return activeSceneId;
    }

    public async Task SetPlayerView(string sceneId, double centerX, double centerY, double zoom)
    {
        RequireGm();
        if (!double.IsFinite(centerX) || !double.IsFinite(centerY) || !double.IsFinite(zoom) || zoom <= 0)
            throw new HubException("The shared map view is invalid.");
        if (sceneId != await store.GetActiveSceneIdAsync())
            throw new HubException("Only the active scene view can be shared with players.");

        await Clients.OthersInGroup(Group(sceneId)).SendAsync(
            "PlayerViewChanged",
            sceneId,
            new { centerX, centerY, zoom });
    }

    // A connection watches one scene at a time.
    public async Task<List<Placement>> JoinScene(string sceneId)
    {
        if (!await store.SceneExistsAsync(sceneId)) throw new HubException("Unknown scene.");
        if (!IsGm && sceneId != await store.GetActiveSceneIdAsync())
            throw new HubException("Players may only join the active scene.");

        if (Context.Items.TryGetValue(SceneKey, out var prev) && prev is string prevId)
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(prevId));

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(sceneId));
        Context.Items[SceneKey] = sceneId;
        return await store.GetPlacementsAsync(sceneId);
    }

    private async Task<bool> CanMoveAsync(string sceneId, string tokenId) =>
        IsGm || await combats.PlayerCanMoveAsync(sceneId, tokenId);

    // Live drag feedback for other viewers; not persisted and not rule-checked, but still permission-checked.
    public async Task PreviewPlacement(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y) || !await CanMoveAsync(sceneId, tokenId)) return;
        await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", new Placement(sceneId, tokenId, x, y));
    }

    // The committed move: enforces who may move and movement limits, and returns the authoritative result.
    public async Task<MoveResult?> MovePlacement(string sceneId, string tokenId, double x, double y)
    {
        MoveResult? result;
        if (await CanMoveAsync(sceneId, tokenId))
            result = await combats.CommitMoveAsync(sceneId, tokenId, x, y, ignoreWalls: IsGm);
        else
        {
            var current = await combats.GetPlacementAsync(sceneId, tokenId);
            result = current is null
                ? null
                : new MoveResult(current, false, "You can't move that token right now.", null);
        }
        if (result is null) return null;
        // Rejected moves still go out so viewers who saw the preview snap back.
        await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", result.Placement);
        await Publish(result.Combat);
        return result;
    }

    public async Task<Placement?> AddPlacement(string sceneId, string tokenId, double x, double y)
    {
        RequireGm();
        var placement = await store.SetPlacementAsync(sceneId, tokenId, x, y);
        if (placement is not null)
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementAdded", placement);
        return placement;
    }

    public async Task RemovePlacement(string sceneId, string tokenId)
    {
        RequireGm();
        if (await store.RemovePlacementAsync(sceneId, tokenId))
        {
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementRemoved", sceneId, tokenId);
            await Publish(await combats.RemoveFromInitiativeAsync(sceneId, tokenId));
        }
    }

    // Scene settings are game-wide too, so everyone sees a recalibrated grid.
    public async Task<Scene?> RenameScene(string sceneId, string name)
    {
        RequireGm();
        var scene = await store.RenameSceneAsync(sceneId, name);
        if (scene is not null)
            await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    public async Task<Scene?> UpdateSceneGrid(string sceneId, int gridSize, int offsetX, int offsetY)
    {
        RequireGm();
        var scene = await store.UpdateSceneGridAsync(sceneId, gridSize, offsetX, offsetY);
        if (scene is not null)
            await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    public async Task<Scene?> UpdateSceneFog(string sceneId, IReadOnlyList<FogArea>? fogAreas)
    {
        RequireGm();
        var scene = await store.UpdateSceneFogAsync(sceneId, fogAreas);
        if (scene is null) throw new HubException("The fog areas are invalid or exceed the supported limits.");
        await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    public async Task<Scene?> UpdateSceneWalls(string sceneId, IReadOnlyList<Wall>? walls)
    {
        RequireGm();
        var scene = await store.UpdateSceneWallsAsync(sceneId, walls);
        if (scene is null) throw new HubException("The walls are invalid or exceed the supported limits.");
        await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    public async Task<Scene?> UpdateSceneLighting(string sceneId, bool enabled)
    {
        RequireGm();
        var scene = await store.UpdateSceneLightingAsync(sceneId, enabled);
        if (scene is null) throw new HubException("Scene not found.");
        await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    // NPC Armour Class is omitted from player views.
    public async Task<Token?> UpdateToken(string tokenId, string name, int hp, int speedFeet, int armorClass)
    {
        if (!IsGm && !await store.IsPlayerTokenAsync(tokenId))
            throw new HubException("Players can only edit player tokens.");
        var token = await store.UpdateTokenAsync(tokenId, name, hp, speedFeet, armorClass);
        if (token is not null)
        {
            await Clients.OthersInGroup(GmGroup).SendAsync("TokenUpdated", token);
            await Clients.Group(PlayerGroup).SendAsync("TokenUpdated", token.ForPlayerView());
        }
        return token;
    }

    public async Task<Token?> UpdateTokenLighting(string tokenId, int visionFeet, int lightFeet)
    {
        RequireGm();
        var token = await store.UpdateTokenLightingAsync(tokenId, visionFeet, lightFeet);
        if (token is not null)
        {
            await Clients.OthersInGroup(GmGroup).SendAsync("TokenUpdated", token);
            await Clients.Group(PlayerGroup).SendAsync("TokenUpdated", token.ForPlayerView());
        }
        return token;
    }

    public async Task<Token?> SetTokenKind(string tokenId, bool isPlayer)
    {
        RequireGm();
        var token = await store.SetTokenKindAsync(tokenId, isPlayer);
        if (token is not null)
        {
            await Clients.OthersInGroup(GmGroup).SendAsync("TokenUpdated", token);
            await Clients.Group(PlayerGroup).SendAsync("TokenUpdated", token.ForPlayerView());
        }
        return token;
    }
}
