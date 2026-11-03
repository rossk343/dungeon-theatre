using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public record MoveSceneRequest(string? ChapterId);

public static class SceneEndpoints
{
    public static void MapSceneEndpoints(this WebApplication app)
    {
        // Antiforgery is disabled because there is no cookie auth yet; revisit when accounts are added.
        var group = app.MapGroup("/api/scenes").DisableAntiforgery();

        group.MapPost("/", async ([FromForm] string? name, [FromForm] string? chapterId, IFormFile? file, GameStore store,
            MapImageStorage images, IHubContext<GameHub> hub) =>
        {
            name = name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 100)
                return Results.BadRequest(new { error = "Scene name must be 1-100 characters." });
            if (string.IsNullOrEmpty(chapterId) || !await store.ChapterExistsAsync(chapterId))
                return Results.BadRequest(new { error = "Choose a chapter for the scene." });

            var (image, error) = await images.SaveAsync(file);
            if (image is null) return Results.BadRequest(new { error });

            try
            {
                var scene = await store.CreateSceneAsync(chapterId, name, image.Url, image.Width, image.Height);
                if (scene is null)
                {
                    images.Delete(image.Url);
                    return Results.BadRequest(new { error = "Choose a chapter for the scene." });
                }
                await hub.Clients.All.SendAsync("SceneAdded", scene);
                return Results.Ok(scene);
            }
            catch
            {
                images.Delete(image.Url);
                throw;
            }
        });

        group.MapPut("/{id}/chapter", async (string id, MoveSceneRequest body, GameStore store,
            IHubContext<GameHub> hub) =>
        {
            var scene = await store.MoveSceneAsync(id, body.ChapterId ?? "");
            if (scene is null) return Results.NotFound();
            await hub.Clients.All.SendAsync("SceneUpdated", scene);
            return Results.Ok(scene);
        });

        group.MapPut("/{id}/image", async (string id, IFormFile? file, GameStore store,
            MapImageStorage images, IHubContext<GameHub> hub) =>
        {
            if (!await store.SceneExistsAsync(id)) return Results.NotFound();

            var (image, error) = await images.SaveAsync(file);
            if (image is null) return Results.BadRequest(new { error });

            var result = await store.SetSceneImageAsync(id, image.Url, image.Width, image.Height);
            if (result is null)
            {
                images.Delete(image.Url);
                return Results.NotFound();
            }

            images.Delete(result.Value.OldImageUrl);
            await hub.Clients.All.SendAsync("SceneUpdated", result.Value.Scene);
            return Results.Ok(result.Value.Scene);
        });

        group.MapDelete("/{id}", async (string id, GameStore store, MapImageStorage images,
            IHubContext<GameHub> hub) =>
        {
            var (found, imageUrl) = await store.DeleteSceneAsync(id);
            if (!found) return Results.NotFound();
            images.Delete(imageUrl);
            await hub.Clients.All.SendAsync("SceneDeleted", id);
            return Results.NoContent();
        });
    }
}
