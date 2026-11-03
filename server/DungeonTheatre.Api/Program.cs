using DungeonTheatre.Api;
using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddDbContext<GameDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Game") ?? "Data Source=dungeon-theatre.db"));
builder.Services.AddScoped<GameStore>();
builder.Services.AddSingleton<MapImageStorage>();

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<GameDbContext>();
    // Seed only a brand-new database so deleting everything doesn't bring the samples back.
    var isNewDatabase = !(await db.Database.GetAppliedMigrationsAsync()).Any();
    await db.Database.MigrateAsync();
    if (isNewDatabase) await SeedData.SeedAsync(db);
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

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapSceneEndpoints();
app.MapChapterEndpoints();
app.MapTokenEndpoints();

app.Run();
