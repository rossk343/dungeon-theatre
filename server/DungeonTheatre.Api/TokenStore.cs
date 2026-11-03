using System.Collections.Concurrent;

namespace DungeonTheatre.Api;

public record Token(string Id, string Name, string Color, double X, double Y);

// In-memory for the vertical slice; replaced by EF Core later.
public class TokenStore
{
    private readonly ConcurrentDictionary<string, Token> _tokens = new(
        new[]
        {
            new Token("t1", "Knight", "#b23a48", 120, 120),
            new Token("t2", "Rogue", "#3a7ca5", 240, 120),
            new Token("t3", "Wraith", "#6b5b95", 360, 240),
        }.ToDictionary(t => t.Id));

    public IReadOnlyCollection<Token> All() => _tokens.Values.ToArray();

    public Token? Move(string id, double x, double y)
    {
        while (_tokens.TryGetValue(id, out var current))
        {
            var moved = current with { X = x, Y = y };
            if (_tokens.TryUpdate(id, moved, current)) return moved;
        }
        return null;
    }
}
