// Only raster formats. SVG and MIME supplied by the browser are not trusted.
export function imageFormat(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length < 12) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))
    return { mime: "image/png", extension: "png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { mime: "image/jpeg", extension: "jpg" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
    return { mime: "image/webp", extension: "webp" };
  return null;
}
