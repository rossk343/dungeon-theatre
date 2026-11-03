using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace DungeonTheatre.Api;

public static class TokenEndpoints
{
    public static void MapTokenEndpoints(this WebApplication app)
    {
        // Antiforgery is disabled because there is no cookie auth yet; revisit when accounts are added.
        var group = app.MapGroup("/api/tokens").DisableAntiforgery();

        // Art is optional on create; a token without it renders as a coloured disc.
        group.MapPost("/", async ([FromForm] string? name, [FromForm] string? color, [FromForm] int? maxHp,
                    [FromForm] int? speedFeet, IFormFile? file, GameStore store, MapImageStorage images, IHubContext<GameHub> hub) =>
        {
            if (!GameStore.IsValidName(name, 40))
                return Results.BadRequest(new { error = "Token name must be 1-40 characters." });
            if (!GameStore.IsValidColor(color))
                return Results.BadRequest(new { error = "Colour must look like #aabbcc." });
            if (maxHp is null or < 1 or > 9999)
                return Results.BadRequest(new { error = "Max HP must be between 1 and 9999." });

            var speed = speedFeet ?? 30;
            if (!GameStore.IsValidSpeed(speed))
                return Results.BadRequest(new { error = "Speed must be between 0 and 999 ft." });

            StoredImage? image = null;
            if (file is not null)
            {
                string? error;
                (image, error) = await images.SaveAsync(file);
                if (image is null) return Results.BadRequest(new { error });
            }

            try
            {
                var token = await store.CreateTokenAsync(name!, color!, maxHp.Value, speed, image?.Url);
                if (token is null)
                {
                    images.Delete(image?.Url);
                    return Results.BadRequest(new { error = "Invalid token." });
                }
                await hub.Clients.All.SendAsync("TokenAdded", token);
                return Results.Ok(token);
            }
            catch
            {
                images.Delete(image?.Url);
                throw;
            }
        });

        group.MapPut("/{id}/image", async (string id, IFormFile? file, GameStore store,
            MapImageStorage images, IHubContext<GameHub> hub) =>
        {
            var (image, error) = await images.SaveAsync(file);
            if (image is null) return Results.BadRequest(new { error });

            var result = await store.SetTokenImageAsync(id, image.Url);
            if (result is null)
            {
                images.Delete(image.Url);
                return Results.NotFound();
            }

            images.Delete(result.Value.OldImageUrl);
            await hub.Clients.All.SendAsync("TokenUpdated", result.Value.Token);
            return Results.Ok(result.Value.Token);
        });

        group.MapDelete("/{id}", async (string id, GameStore store, CombatStore combats, MapImageStorage images,
            IHubContext<GameHub> hub) =>
        {
            // Hand the turn on in every scene before the token (and its initiative rows) disappears.
            foreach (var combat in await combats.RemoveTokenFromAllAsync(id))
                await hub.Clients.Group(GameHub.Group(combat.SceneId)).SendAsync("CombatUpdated", combat);
            var (found, imageUrl) = await store.DeleteTokenAsync(id);
            if (!found) return Results.NotFound();
            images.Delete(imageUrl);
            await hub.Clients.All.SendAsync("TokenDeleted", id);
            return Results.NoContent();
        });
    }
}
