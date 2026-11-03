using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public class GameHub(GameStore store, CombatStore combats) : Hub
{
    private const string SceneKey = "scene";

    public static string Group(string sceneId) => $"scene:{sceneId}";

    public Task<Combat> GetCombat(string sceneId) => combats.GetCombatAsync(sceneId);

    private Task Publish(Combat? combat) =>
        combat is null ? Task.CompletedTask : Clients.Group(Group(combat.SceneId)).SendAsync("CombatUpdated", combat);

    public async Task SetInitiative(string sceneId, string tokenId, int initiative) =>
        await Publish(await combats.SetInitiativeAsync(sceneId, tokenId, initiative));

    public async Task RemoveInitiative(string sceneId, string tokenId) =>
        await Publish(await combats.RemoveFromInitiativeAsync(sceneId, tokenId));

    public async Task StartCombat(string sceneId) => await Publish(await combats.StartCombatAsync(sceneId));

    public async Task EndCombat(string sceneId) => await Publish(await combats.EndCombatAsync(sceneId));

    public async Task NextTurn(string sceneId) => await Publish(await combats.NextTurnAsync(sceneId));

    public async Task ResetMovement(string sceneId) => await Publish(await combats.ResetMovementAsync(sceneId));

    public Task<GameState> GetState() => store.GetStateAsync();

    // A connection watches one scene at a time.
    public async Task<List<Placement>> JoinScene(string sceneId)
    {
        if (!await store.SceneExistsAsync(sceneId)) throw new HubException("Unknown scene.");

        if (Context.Items.TryGetValue(SceneKey, out var prev) && prev is string prevId)
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(prevId));

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(sceneId));
        Context.Items[SceneKey] = sceneId;
        return await store.GetPlacementsAsync(sceneId);
    }

    // Live drag feedback for other viewers; not persisted and not rule-checked.
    public Task PreviewPlacement(string sceneId, string tokenId, double x, double y) =>
        double.IsFinite(x) && double.IsFinite(y)
            ? Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", new Placement(sceneId, tokenId, x, y))
            : Task.CompletedTask;

    // The committed move: enforces movement limits and returns the authoritative result.
    public async Task<MoveResult?> MovePlacement(string sceneId, string tokenId, double x, double y)
    {
        var result = await combats.CommitMoveAsync(sceneId, tokenId, x, y);
        if (result is null) return null;
        // Rejected moves still go out so viewers who saw the preview snap back.
        await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", result.Placement);
        await Publish(result.Combat);
        return result;
    }

    public async Task<Placement?> AddPlacement(string sceneId, string tokenId, double x, double y)
    {
        var placement = await store.SetPlacementAsync(sceneId, tokenId, x, y);
        if (placement is not null)
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementAdded", placement);
        return placement;
    }

    public async Task RemovePlacement(string sceneId, string tokenId)
    {
        if (await store.RemovePlacementAsync(sceneId, tokenId))
        {
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementRemoved", sceneId, tokenId);
            await Publish(await combats.RemoveFromInitiativeAsync(sceneId, tokenId));
        }
    }

    // Scene settings are game-wide too, so everyone sees a recalibrated grid.
    public async Task<Scene?> RenameScene(string sceneId, string name)
    {
        var scene = await store.RenameSceneAsync(sceneId, name);
        if (scene is not null)
            await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    public async Task<Scene?> UpdateSceneGrid(string sceneId, int gridSize, int offsetX, int offsetY)
    {
        var scene = await store.UpdateSceneGridAsync(sceneId, gridSize, offsetX, offsetY);
        if (scene is not null)
            await Clients.Others.SendAsync("SceneUpdated", scene);
        return scene;
    }

    // Token properties are game-wide, so every connection hears about them.
    public async Task<Token?>     UpdateToken(string tokenId, string name, int hp, int speedFeet)
    {
            var token = await store.UpdateTokenAsync(tokenId, name, hp, speedFeet);
        if (token is not null)
            await Clients.Others.SendAsync("TokenUpdated", token);
        return token;
    }
}
