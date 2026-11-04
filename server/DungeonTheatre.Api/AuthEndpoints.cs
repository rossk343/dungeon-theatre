using System.Security.Claims;
using DungeonTheatre.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace DungeonTheatre.Api;

public record RegisterRequest(string? Username, string? Password, string? DisplayName, string? InviteCode);
public record LoginRequest(string? Username, string? Password);
public record GuestRequest(string? DisplayName, string? InviteCode);
public record Session(AuthUser User, string? InviteCode);

public static class AuthEndpoints
{
    public static ClaimsPrincipal ToPrincipal(UserEntity u) =>
        new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, u.Id),
                new Claim(ClaimTypes.Name, u.DisplayName),
                new Claim(ClaimTypes.Role, u.Role),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme));

    public static string UserId(this ClaimsPrincipal p) => p.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

    public static bool IsGm(this ClaimsPrincipal p) => p.IsInRole(Roles.Gm);

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth");

        // Lets the login screen tell a brand-new game (create the GM) from an existing one.
        group.MapGet("/status", async (AuthStore auth) => Results.Ok(new { hasUsers = await auth.HasUsersAsync() }));

        group.MapGet("/me", async (ClaimsPrincipal principal, AuthStore auth) =>
        {
            var user = await auth.FindAsync(principal.UserId());
            if (user is null) return Results.Unauthorized();
            return Results.Ok(await ToSession(user, auth));
        }).RequireAuthorization();

        group.MapPost("/register", async (RegisterRequest body, HttpContext http, AuthStore auth) =>
        {
            var result = await auth.RegisterAsync(body.Username, body.Password, body.DisplayName, body.InviteCode);
            return await SignIn(result, http, auth, persistent: true);
        }).RequireRateLimiting("auth");

        group.MapPost("/login", async (LoginRequest body, HttpContext http, AuthStore auth) =>
        {
            var result = await auth.LoginAsync(body.Username, body.Password);
            return await SignIn(result, http, auth, persistent: true);
        }).RequireRateLimiting("auth");

        group.MapPost("/guest", async (GuestRequest body, HttpContext http, AuthStore auth) =>
        {
            var result = await auth.JoinAsGuestAsync(body.DisplayName, body.InviteCode);
            return await SignIn(result, http, auth, persistent: true);
        }).RequireRateLimiting("auth");

        group.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        group.MapPost("/invite", async (AuthStore auth) => Results.Ok(new { inviteCode = await auth.RegenerateInviteCodeAsync() }))
            .RequireAuthorization("gm");
    }

    private static async Task<Session> ToSession(UserEntity user, AuthStore auth) =>
        new(AuthStore.Describe(user), user.Role == Roles.Gm ? await auth.GetInviteCodeAsync() : null);

    private static async Task<IResult> SignIn(AuthResult result, HttpContext http, AuthStore auth, bool persistent)
    {
        if (result.Entity is null) return Results.BadRequest(new { error = result.Error });
        await http.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            ToPrincipal(result.Entity),
            new AuthenticationProperties { IsPersistent = persistent });
        return Results.Ok(await ToSession(result.Entity, auth));
    }
}
