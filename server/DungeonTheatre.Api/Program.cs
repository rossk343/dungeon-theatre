using DungeonTheatre.Api;
using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddDbContext<GameDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Game") ?? "Data Source=dungeon-theatre.db"));
builder.Services.AddScoped<GameStore>();

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<GameDbContext>();
    await db.Database.MigrateAsync();
    await SeedData.EnsureSeededAsync(db);
}

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.Run();
