using System.Threading.RateLimiting;
using DungeonTheatre.Api;
using DungeonTheatre.Api.Data;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddDbContext<GameDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Game") ?? "Data Source=dungeon-theatre.db"));
builder.Services.AddScoped<GameStore>();
builder.Services.AddScoped<CombatStore>();
builder.Services.AddScoped<AuthStore>();
builder.Services.AddSingleton<IPasswordHasher<UserEntity>, PasswordHasher<UserEntity>>();
builder.Services.AddSingleton<MapImageStorage>();

// SameSite=Strict keeps the cookie off cross-site requests, which is what protects the
// cookie-authenticated upload and delete endpoints from CSRF.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "dt.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
        // APIs answer 401/403 instead of redirecting to a login page.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("gm", p => p.RequireRole(Roles.Gm));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<GameDbContext>();
    // Seed only a brand-new database so deleting everything doesn't bring the samples back.
    var isNewDatabase = !(await db.Database.GetAppliedMigrationsAsync()).Any();
    await db.Database.MigrateAsync();
    if (isNewDatabase) await SeedData.SeedAsync(db);
    await scope.ServiceProvider.GetRequiredService<AuthStore>().EnsureInviteCodeAsync();
}

var images = app.Services.GetRequiredService<MapImageStorage>();
Directory.CreateDirectory(images.Root);
// Filenames are random GUIDs, so uploads can be cached indefinitely.
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(images.Root),
    RequestPath = "/uploads",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers.XContentTypeOptions = "nosniff";
        ctx.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
    },
});

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthEndpoints();
app.MapSceneEndpoints();
app.MapChapterEndpoints();
app.MapTokenEndpoints();

app.Run();
