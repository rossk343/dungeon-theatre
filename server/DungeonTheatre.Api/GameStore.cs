namespace DungeonTheatre.Api;

// Persistent identity; shared across every scene.
public record Token(string Id, string Name, string Color, int Hp, int MaxHp);

public record Scene(string Id, string Name, int Width, int Height, int GridSize);

// Where a token sits on one scene, in map pixel coordinates.
public record Placement(string SceneId, string TokenId, double X, double Y);

public record GameState(IReadOnlyList<Scene> Scenes, IReadOnlyList<Token> Tokens);

// In-memory for the vertical slice; replaced by EF Core later.
public class GameStore
{
    private readonly object _lock = new();
    private readonly List<Scene> _scenes =
    [
        new("crypt", "The Sunken Crypt", 1200, 720, 60),
        new("bridge", "Bridge of Sighs", 1200, 720, 80),
    ];
    private readonly Dictionary<string, Token> _tokens = new()
    {
        ["t1"] = new("t1", "Knight", "#b23a48", 34, 34),
        ["t2"] = new("t2", "Rogue", "#3a7ca5", 22, 22),
        ["t3"] = new("t3", "Wraith", "#6b5b95", 45, 45),
    };
    private readonly List<Placement> _placements =
    [
        new("crypt", "t1", 150, 150),
        new("crypt", "t2", 270, 150),
        new("crypt", "t3", 390, 270),
        new("bridge", "t1", 120, 120),
        new("bridge", "t2", 200, 120),
    ];

    public GameState GetState()
    {
        lock (_lock) return new GameState(_scenes.ToList(), _tokens.Values.ToList());
    }

    public bool SceneExists(string sceneId)
    {
        lock (_lock) return _scenes.Any(s => s.Id == sceneId);
    }

    public List<Placement> GetPlacements(string sceneId)
    {
        lock (_lock) return _placements.Where(p => p.SceneId == sceneId).ToList();
    }

    // Adds the placement, or moves it if the token is already on the scene.
    public Placement? SetPlacement(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        lock (_lock)
        {
            if (!_tokens.ContainsKey(tokenId) || !_scenes.Any(s => s.Id == sceneId)) return null;
            var placement = new Placement(sceneId, tokenId, x, y);
            var i = _placements.FindIndex(p => p.SceneId == sceneId && p.TokenId == tokenId);
            if (i >= 0) _placements[i] = placement;
            else _placements.Add(placement);
            return placement;
        }
    }

    public Placement? MovePlacement(string sceneId, string tokenId, double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return null;
        lock (_lock)
        {
            var i = _placements.FindIndex(p => p.SceneId == sceneId && p.TokenId == tokenId);
            if (i < 0) return null;
            return _placements[i] = _placements[i] with { X = x, Y = y };
        }
    }

    public bool RemovePlacement(string sceneId, string tokenId)
    {
        lock (_lock) return _placements.RemoveAll(p => p.SceneId == sceneId && p.TokenId == tokenId) > 0;
    }

    public Token? UpdateToken(string tokenId, string name, int hp)
    {
        name = name.Trim();
        if (name.Length is 0 or > 40) return null;
        lock (_lock)
        {
            if (!_tokens.TryGetValue(tokenId, out var token)) return null;
            return _tokens[tokenId] = token with { Name = name, Hp = Math.Clamp(hp, 0, token.MaxHp) };
        }
    }
}
