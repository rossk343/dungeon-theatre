namespace DungeonTheatre.Api;

public record StoredImage(string Url, int Width, int Height);

public class MapImageStorage(IWebHostEnvironment env)
{
    public const int MaxBytes = 25 * 1024 * 1024;
    public const int MaxDimension = 10_000;
    private const long MaxPixels = 64_000_000;
    public const string UrlPrefix = "/uploads/";

    public string Root { get; } = Path.Combine(env.ContentRootPath, "uploads");

    // Returns the stored image, or an error message safe to show the user.
    public async Task<(StoredImage? Image, string? Error)> SaveAsync(IFormFile? file)
    {
        if (file is null || file.Length == 0) return (null, "An image file is required.");
        if (file.Length > MaxBytes) return (null, "Image is too large (25 MB max).");

        await using var input = file.OpenReadStream();
        var data = new byte[file.Length];
        await input.ReadExactlyAsync(data);

        var info = ImageInspector.Inspect(data);
        if (info is null) return (null, "Unsupported image. Use PNG, JPEG, WebP or GIF up to 10000x10000.");
        if ((long)info.Width * info.Height > MaxPixels) return (null, "Image has too many pixels (64 MP max).");

        Directory.CreateDirectory(Root);
        var name = $"{Guid.NewGuid():N}{info.Extension}";
        await File.WriteAllBytesAsync(Path.Combine(Root, name), data);
        return (new StoredImage(UrlPrefix + name, info.Width, info.Height), null);
    }

    // Only ever deletes files directly inside the uploads folder.
    public void Delete(string? url)
    {
        if (url is null || !url.StartsWith(UrlPrefix, StringComparison.Ordinal)) return;
        var path = Path.Combine(Root, Path.GetFileName(url));
        try { File.Delete(path); } catch (IOException) { }
    }
}
