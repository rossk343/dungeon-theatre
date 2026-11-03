using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public class GameHub(GameStore store) : Hub
{
    private const string SceneKey = "scene";

    private static string Group(string sceneId) => $"scene:{sceneId}";

    public GameState GetState() => store.GetState();

    // A connection watches one scene at a time.
    public async Task<List<Placement>> JoinScene(string sceneId)
    {
        if (!store.SceneExists(sceneId)) throw new HubException("Unknown scene.");

        if (Context.Items.TryGetValue(SceneKey, out var prev) && prev is string prevId)
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(prevId));

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(sceneId));
        Context.Items[SceneKey] = sceneId;
        return store.GetPlacements(sceneId);
    }

    // Fires continuously while dragging; clients interpolate.
    public async Task MovePlacement(string sceneId, string tokenId, double x, double y)
    {
        var placement = store.MovePlacement(sceneId, tokenId, x, y);
        if (placement is not null)
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementMoved", placement);
    }

    public async Task<Placement?> AddPlacement(string sceneId, string tokenId, double x, double y)
    {
        var placement = store.SetPlacement(sceneId, tokenId, x, y);
        if (placement is not null)
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementAdded", placement);
        return placement;
    }

    public async Task RemovePlacement(string sceneId, string tokenId)
    {
        if (store.RemovePlacement(sceneId, tokenId))
            await Clients.OthersInGroup(Group(sceneId)).SendAsync("PlacementRemoved", sceneId, tokenId);
    }

    // Token properties are game-wide, so every connection hears about them.
    public async Task<Token?> UpdateToken(string tokenId, string name, int hp)
    {
        var token = store.UpdateToken(tokenId, name, hp);
        if (token is not null)
            await Clients.Others.SendAsync("TokenUpdated", token);
        return token;
    }
}
