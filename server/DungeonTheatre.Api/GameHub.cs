using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public class GameHub(GameStore store) : Hub
{
    private const string SceneKey = "scene";

    private static string Group(string sceneId) => $"scene:{sceneId}";

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

    // Fires continuously while dragging; clients interpolate.
    public async Task MovePlacement(string sceneId, string tokenId, double x, double y)
    {
        var placement = await store.MovePlacementAsync(sceneId, tokenId, x, y);
        if (placement is not null)
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", placement);
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
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementRemoved", sceneId, tokenId);
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
    public async Task<Token?> UpdateToken(string tokenId, string name, int hp)
    {
        var token = await store.UpdateTokenAsync(tokenId, name, hp);
        if (token is not null)
            await Clients.Others.SendAsync("TokenUpdated", token);
        return token;
    }
}
