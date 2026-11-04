using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public record ChapterNameRequest(string? Name);

public static class ChapterEndpoints
{
    public static void MapChapterEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/chapters").DisableAntiforgery().RequireAuthorization("gm");

        group.MapPost("/", async (ChapterNameRequest body, GameStore store, IHubContext<GameHub> hub) =>
        {
            var chapter = await store.CreateChapterAsync(body.Name ?? "");
            if (chapter is null) return Results.BadRequest(new { error = "Chapter name must be 1-100 characters." });
            await hub.Clients.All.SendAsync("ChapterAdded", chapter);
            return Results.Ok(chapter);
        });

        group.MapPut("/{id}", async (string id, ChapterNameRequest body, GameStore store, IHubContext<GameHub> hub) =>
        {
            if (!await store.ChapterExistsAsync(id)) return Results.NotFound();
            var chapter = await store.RenameChapterAsync(id, body.Name ?? "");
            if (chapter is null) return Results.BadRequest(new { error = "Chapter name must be 1-100 characters." });
            await hub.Clients.All.SendAsync("ChapterUpdated", chapter);
            return Results.Ok(chapter);
        });

        group.MapDelete("/{id}", async (string id, GameStore store, IHubContext<GameHub> hub) =>
        {
            switch (await store.DeleteChapterAsync(id))
            {
                case GameStore.DeleteChapterResult.NotFound:
                    return Results.NotFound();
                case GameStore.DeleteChapterResult.NotEmpty:
                    return Results.Conflict(new { error = "Move or delete this chapter's scenes first." });
            }
            await hub.Clients.All.SendAsync("ChapterDeleted", id);
            return Results.NoContent();
        });
    }
}
