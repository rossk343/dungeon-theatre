using DungeonTheatre.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<GameStore>();

var app = builder.Build();

app.MapHub<GameHub>("/hubs/game");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.Run();
