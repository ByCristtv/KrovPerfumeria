// @vitest-environment node
// sharp needs real Node Buffers/typed arrays; jsdom's realm breaks its input checks.
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { AvatarError, processAvatar, sniffImageFormat } from "./processAvatar";
import { AVATAR_MAX_INPUT_BYTES, AVATAR_MAX_OUTPUT_BYTES, AVATAR_SIZE_PX } from "./constants";

const solid = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 80 } },
  });

/** Pseudo-random noise: incompressible, so it stresses the size ceiling. */
const noise = async (size: number) => {
  const raw = Buffer.alloc(size * size * 3);
  let seed = 1;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    raw[i] = seed >>> 24;
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } });
};

const rejection = async (input: Uint8Array) => {
  try {
    await processAvatar(input);
  } catch (err) {
    return err;
  }
  return null;
};

describe("sniffImageFormat", () => {
  it("recognises JPEG, PNG and WebP by their leading bytes", async () => {
    expect(sniffImageFormat(await solid(8, 8).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImageFormat(await solid(8, 8).png().toBuffer())).toBe("png");
    expect(sniffImageFormat(await solid(8, 8).webp().toBuffer())).toBe("webp");
  });

  it("rejects everything else, whatever it is called", async () => {
    const enc = new TextEncoder();
    expect(sniffImageFormat(await solid(8, 8).gif().toBuffer())).toBeNull();
    expect(sniffImageFormat(enc.encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageFormat(enc.encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImageFormat(enc.encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
    // RIFF container that is not WebP (e.g. a WAV).
    expect(sniffImageFormat(enc.encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
  });
});

describe("processAvatar", () => {
  it.each([
    ["jpeg", () => solid(1600, 900).jpeg().toBuffer()],
    ["png", () => solid(900, 1600).png().toBuffer()],
    ["webp", () => solid(300, 300).webp().toBuffer()],
  ])("turns a %s into a 512×512 WebP under the size ceiling", async (_name, make) => {
    const out = await processAvatar(await make());

    expect(out.contentType).toBe("image/webp");
    expect(sniffImageFormat(out.buffer)).toBe("webp");
    expect(out.buffer.byteLength).toBeLessThanOrEqual(AVATAR_MAX_OUTPUT_BYTES);

    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(AVATAR_SIZE_PX);
    expect(meta.height).toBe(AVATAR_SIZE_PX);
  });

  it("strips EXIF (including GPS) from the output", async () => {
    const withExif = await solid(800, 600)
      .jpeg()
      .withExif({
        IFD0: { Copyright: "secret-owner", Make: "SecretCam" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" },
      })
      .toBuffer();
    // Sanity: the fixture really does carry metadata.
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const out = await processAvatar(withExif);

    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.buffer.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(out.buffer.includes(Buffer.from("SecretCam"))).toBe(false);
  });

  it("applies EXIF orientation to the pixels before dropping it", async () => {
    // 200×100 landscape tagged "rotate 90°": displays as 100×200 portrait.
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 0,
        },
      ])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const out = await processAvatar(rotated);

    // Orientation 6 rotates 90° clockwise: the blue right half becomes the bottom half.
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const top = px(256, 20);
    const bottom = px(256, 490);
    expect(top[0]).toBeGreaterThan(200); // red
    expect(bottom[2]).toBeGreaterThan(200); // blue
  });

  it("re-encodes incompressible input to fit the ceiling instead of passing it through", async () => {
    const out = await processAvatar(await (await noise(1200)).png().toBuffer());
    expect(out.buffer.byteLength).toBeLessThanOrEqual(AVATAR_MAX_OUTPUT_BYTES);
  });

  it("ignores anything appended after a valid image (polyglot payload)", async () => {
    const png = await solid(64, 64).png().toBuffer();
    const polyglot = Buffer.concat([png, Buffer.from("<?php system($_GET['c']); ?>")]);

    const out = await processAvatar(polyglot);

    expect(out.buffer.includes(Buffer.from("<?php"))).toBe(false);
  });

  describe("rejects with a user-facing AvatarError", () => {
    it("an empty file", async () => {
      const err = await rejection(new Uint8Array(0));
      expect(err).toBeInstanceOf(AvatarError);
      expect((err as AvatarError).code).toBe("empty");
    });

    it("a file over the 10 MB input cap", async () => {
      const err = await rejection(new Uint8Array(AVATAR_MAX_INPUT_BYTES + 1));
      expect((err as AvatarError).code).toBe("too_large");
    });

    it.each([
      ["GIF", () => solid(8, 8).gif().toBuffer()],
      ["SVG", async () => Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>")],
      ["HTML renamed .png", async () => Buffer.from("<html></html>")],
    ])("a %s", async (_name, make) => {
      const err = await rejection(await make());
      expect(err).toBeInstanceOf(AvatarError);
      expect((err as AvatarError).code).toBe("unsupported_format");
    });

    it("a file with a valid JPEG header but garbage body", async () => {
      const bogus = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
      const err = await rejection(bogus);
      expect((err as AvatarError).code).toBe("invalid_image");
    });

    it("a truncated PNG", async () => {
      const png = await solid(400, 400).png().toBuffer();
      const err = await rejection(png.subarray(0, Math.floor(png.length / 2)));
      expect((err as AvatarError).code).toBe("invalid_image");
    });

    it("an image whose declared canvas exceeds the pixel limit", async () => {
      // 8000×8000 = 64 MP of flat colour: tiny on disk, huge once decoded.
      const bomb = await solid(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
      expect(bomb.byteLength).toBeLessThan(AVATAR_MAX_INPUT_BYTES);
      const err = await rejection(bomb);
      expect((err as AvatarError).code).toBe("invalid_image");
    });
  });
});
