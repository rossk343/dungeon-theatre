using System.Buffers.Binary;

namespace DungeonTheatre.Api;

public record ImageInfo(string Extension, int Width, int Height);

// Identifies an image by its magic bytes and reads its size from the header, so the
// client-supplied filename and content type are never trusted.
public static class ImageInspector
{
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] WebPFrameStart = [0x9D, 0x01, 0x2A];

    public static ImageInfo? Inspect(ReadOnlySpan<byte> d)
    {
        if (d.Length < 12) return null;
        if (d[..8].SequenceEqual(PngSignature)) return Png(d);
        if (d[0] == 0xFF && d[1] == 0xD8) return Jpeg(d);
        if (d[..4].SequenceEqual("GIF8"u8)) return Gif(d);
        if (d[..4].SequenceEqual("RIFF"u8) && d[8..12].SequenceEqual("WEBP"u8)) return WebP(d);
        return null;
    }

    private static ImageInfo? Png(ReadOnlySpan<byte> d)
    {
        if (d.Length < 24 || !d[12..16].SequenceEqual("IHDR"u8)) return null;
        return Make(".png", BinaryPrimitives.ReadInt32BigEndian(d[16..]), BinaryPrimitives.ReadInt32BigEndian(d[20..]));
    }

    private static ImageInfo? Gif(ReadOnlySpan<byte> d) =>
        Make(".gif", BinaryPrimitives.ReadUInt16LittleEndian(d[6..]), BinaryPrimitives.ReadUInt16LittleEndian(d[8..]));

    private static ImageInfo? Jpeg(ReadOnlySpan<byte> d)
    {
        var i = 2;
        while (i + 4 <= d.Length)
        {
            if (d[i] != 0xFF) { i++; continue; }
            var marker = d[i + 1];
            if (marker == 0xFF) { i++; continue; }
            // Standalone markers carry no length.
            if (marker is 0x01 or 0xD8 or (>= 0xD0 and <= 0xD7)) { i += 2; continue; }
            var length = BinaryPrimitives.ReadUInt16BigEndian(d[(i + 2)..]);
            var isFrameHeader = marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC;
            if (isFrameHeader)
            {
                if (i + 9 > d.Length) return null;
                return Make(".jpg", BinaryPrimitives.ReadUInt16BigEndian(d[(i + 7)..]),
                    BinaryPrimitives.ReadUInt16BigEndian(d[(i + 5)..]));
            }
            i += 2 + length;
        }
        return null;
    }

    private static ImageInfo? WebP(ReadOnlySpan<byte> d)
    {
        if (d.Length < 30) return null;
        var chunk = d[12..16];
        if (chunk.SequenceEqual("VP8 "u8))
        {
            if (!d[23..26].SequenceEqual(WebPFrameStart)) return null;
            return Make(".webp", BinaryPrimitives.ReadUInt16LittleEndian(d[26..]) & 0x3FFF,
                BinaryPrimitives.ReadUInt16LittleEndian(d[28..]) & 0x3FFF);
        }
        if (chunk.SequenceEqual("VP8L"u8))
        {
            if (d[20] != 0x2F) return null;
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(d[21..]);
            return Make(".webp", (int)(bits & 0x3FFF) + 1, (int)((bits >> 14) & 0x3FFF) + 1);
        }
        if (chunk.SequenceEqual("VP8X"u8))
        {
            var w = (d[24] | d[25] << 8 | d[26] << 16) + 1;
            var h = (d[27] | d[28] << 8 | d[29] << 16) + 1;
            return Make(".webp", w, h);
        }
        return null;
    }

    private static ImageInfo? Make(string ext, int w, int h) =>
        w is < 1 or > MapImageStorage.MaxDimension || h is < 1 or > MapImageStorage.MaxDimension
            ? null
            : new ImageInfo(ext, w, h);
}
