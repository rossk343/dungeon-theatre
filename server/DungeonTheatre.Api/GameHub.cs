using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public class GameHub(TokenStore store) : Hub
{
    public IReadOnlyCollection<Token> GetTokens() => store.All();

    // Fires continuously while dragging; clients interpolate.
    public async Task MoveToken(string id, double x, double y)
    {
        var token = store.Move(id, x, y);
        if (token is not null)
            await Clients.Others.SendAsync("TokenMoved", token);
    }
}
