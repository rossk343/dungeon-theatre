using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DungeonTheatre.Api.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DungeonTheatre.Api;

public record AuthUser(string Id, string DisplayName, string Role, bool IsGuest);

public record AuthResult(AuthUser? User, string? Error, UserEntity? Entity = null);

public partial class AuthStore(GameDbContext db, IPasswordHasher<UserEntity> hasher)
{
    // Registration checks "is anyone here yet?" and then inserts, so it must not interleave.
    private static readonly SemaphoreSlim RegisterLock = new(1, 1);
    private const string InviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static readonly UserEntity DummyUser = new() { Id = "", GameId = "", DisplayName = "", Role = Roles.Player };
    private static readonly string DummyHash = new PasswordHasher<UserEntity>().HashPassword(DummyUser, "not-a-real-password");

    [GeneratedRegex("^[A-Za-z0-9_.-]{3,32}$")]
    private static partial Regex UsernamePattern();

    public static string NewInviteCode() => RandomNumberGenerator.GetString(InviteAlphabet, 8);

    private static AuthUser ToDto(UserEntity u) => new(u.Id, u.DisplayName, u.Role, u.IsGuest);

    public Task<bool> HasUsersAsync() => db.Users.AnyAsync();

    public async Task EnsureInviteCodeAsync()
    {
        var game = await db.Games.FindAsync(GameStore.DefaultGameId);
        if (game is null || game.InviteCode != "") return;
        game.InviteCode = NewInviteCode();
        await db.SaveChangesAsync();
    }

    public async Task<string> GetInviteCodeAsync() =>
        (await db.Games.AsNoTracking().FirstAsync(g => g.Id == GameStore.DefaultGameId)).InviteCode;

    public async Task<string> RegenerateInviteCodeAsync()
    {
        var game = await db.Games.FirstAsync(g => g.Id == GameStore.DefaultGameId);
        game.InviteCode = NewInviteCode();
        await db.SaveChangesAsync();
        return game.InviteCode;
    }

    private async Task<bool> InviteMatchesAsync(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return false;
        var expected = Encoding.UTF8.GetBytes(await GetInviteCodeAsync());
        var given = Encoding.UTF8.GetBytes(code.Trim().ToUpperInvariant());
        return CryptographicOperations.FixedTimeEquals(expected, given);
    }

    public async Task<UserEntity?> FindAsync(string userId) => await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);

    // The first account ever created is the GM and needs no invite; everyone after needs the code.
    public async Task<AuthResult> RegisterAsync(string? username, string? password, string? displayName, string? inviteCode)
    {
        username = username?.Trim().ToLowerInvariant();
        displayName = string.IsNullOrWhiteSpace(displayName) ? username : displayName.Trim();
        if (username is null || !UsernamePattern().IsMatch(username))
            return new(null, "Username must be 3-32 letters, numbers, dots, dashes or underscores.");
        if (password is null || password.Length is < 8 or > 128)
            return new(null, "Password must be 8-128 characters.");
        if (displayName is null || displayName.Length > 40)
            return new(null, "Display name must be at most 40 characters.");

        await RegisterLock.WaitAsync();
        try
        {
            var first = !await db.Users.AnyAsync();
            if (!first && !await InviteMatchesAsync(inviteCode)) return new(null, "That invite code isn't valid.");
            if (await db.Users.AnyAsync(u => u.Username == username)) return new(null, "That username is taken.");

            var user = new UserEntity
            {
                Id = Guid.NewGuid().ToString("N"),
                GameId = GameStore.DefaultGameId,
                Username = username,
                DisplayName = displayName,
                Role = first ? Roles.Gm : Roles.Player,
            };
            user.PasswordHash = hasher.HashPassword(user, password);
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return new(ToDto(user), null, user);
        }
        finally
        {
            RegisterLock.Release();
        }
    }

    public async Task<AuthResult> LoginAsync(string? username, string? password)
    {
        const string failure = "Wrong username or password.";
        username = username?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password)) return new(null, failure);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username && !u.IsGuest);
        // Hash anyway for unknown users so timing doesn't reveal which usernames exist.
        if (user?.PasswordHash is null)
        {
            hasher.VerifyHashedPassword(DummyUser, DummyHash, password);
            return new(null, failure);
        }
        var result = hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (result == PasswordVerificationResult.Failed) return new(null, failure);
        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = hasher.HashPassword(user, password);
            await db.SaveChangesAsync();
        }
        return new(ToDto(user), null, user);
    }

    public async Task<AuthResult> JoinAsGuestAsync(string? displayName, string? inviteCode)
    {
        displayName = displayName?.Trim();
        if (string.IsNullOrEmpty(displayName) || displayName.Length > 40)
            return new(null, "Display name must be 1-40 characters.");
        // Guests can't exist before a GM does, or they'd get no one to play with and no way in as GM.
        if (!await db.Users.AnyAsync(u => u.Role == Roles.Gm)) return new(null, "The GM hasn't set up the game yet.");
        if (!await InviteMatchesAsync(inviteCode)) return new(null, "That invite code isn't valid.");

        var user = new UserEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            GameId = GameStore.DefaultGameId,
            DisplayName = displayName,
            Role = Roles.Player,
            IsGuest = true,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return new(ToDto(user), null, user);
    }

    public static AuthUser Describe(UserEntity u) => ToDto(u);
}
