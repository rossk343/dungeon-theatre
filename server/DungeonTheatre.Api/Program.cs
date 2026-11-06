using System.Threading.RateLimiting;
using DungeonTheatre.Api;
using DungeonTheatre.Api.Data;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using System.Net.NetworkInformation;
using System.Net.Sockets;

var portable = File.Exists(Path.Combine(AppContext.BaseDirectory, "dungeon-theatre-portable"));
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = portable ? AppContext.BaseDirectory : null,
});

var dataRoot = portable
    ? builder.Configuration["DungeonTheatre:DataDirectory"] ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DungeonTheatre")
    : builder.Environment.ContentRootPath;
if (portable)
{
    if (!Path.IsPathFullyQualified(dataRoot))
        throw new InvalidOperationException("DungeonTheatre:DataDirectory must be an absolute path.");
    Directory.CreateDirectory(dataRoot);
    builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);
    builder.Services.AddDataProtection()
        .SetApplicationName("DungeonTheatre")
        .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataRoot, "keys")));
    if (string.IsNullOrEmpty(builder.Configuration["urls"]))
        builder.WebHost.UseUrls("http://0.0.0.0:8080");
}

builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 128 * 1024);
builder.Services.AddDbContext<GameDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Game") ?? (portable
        ? new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder { DataSource = Path.Combine(dataRoot, "dungeon-theatre.db") }.ToString()
        : "Data Source=dungeon-theatre.db")));
builder.Services.AddScoped<GameStore>();
builder.Services.AddScoped<CombatStore>();
builder.Services.AddScoped<AuthStore>();
builder.Services.AddSingleton<IPasswordHasher<UserEntity>, PasswordHasher<UserEntity>>();
builder.Services.AddSingleton(new MapImageStorage(dataRoot));

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

if (portable && !File.Exists(Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html")))
    throw new InvalidOperationException("The website files are missing. Keep the wwwroot folder alongside the executable.");

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

if (portable)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthEndpoints();
app.MapSceneEndpoints();
app.MapChapterEndpoints();
app.MapTokenEndpoints();

if (portable)
{
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        Console.WriteLine();
        Console.WriteLine("Dungeon Theatre is running. Keep this window open while playing.");
        Console.WriteLine("Server addresses: " + string.Join(", ", app.Urls));
        if (app.Urls.Contains("http://0.0.0.0:8080"))
        {
            Console.WriteLine("On this PC: http://localhost:8080");
            var addresses = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && !System.Net.IPAddress.IsLoopback(a.Address))
                .Select(a => a.Address.ToString()).Distinct();
            foreach (var address in addresses)
                Console.WriteLine($"On your local network: http://{address}:8080");
        }
        Console.WriteLine($"Game data: {dataRoot}");
        Console.WriteLine("Press Ctrl+C or close this window to stop the server.");
    });
}

app.Run();
