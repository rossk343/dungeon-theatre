using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public static class SceneEndpoints
{
    public static void MapSceneEndpoints(this WebApplication app)
    {
        // Antiforgery is disabled because there is no cookie auth yet; revisit when accounts are added.
        var group = app.MapGroup("/api/scenes").DisableAntiforgery();

        group.MapPost("/", async ([FromForm] string? name, IFormFile? file, GameStore store,
            MapImageStorage images, IHubContext<GameHub> hub) =>
        {
            name = name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 100)
                return Results.BadRequest(new { error = "Scene name must be 1-100 characters." });

            var (image, error) = await images.SaveAsync(file);
            if (image is null) return Results.BadRequest(new { error });

            try
            {
                var scene = await store.CreateSceneAsync(name, image.Url, image.Width, image.Height);
                await hub.Clients.All.SendAsync("SceneAdded", scene);
                return Results.Ok(scene);
            }
            catch
            {
                images.Delete(image.Url);
                throw;
            }
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
    }
}
