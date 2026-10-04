import { describe, it, expect } from "vitest";
import { avatarPathFromUrl, buildAvatarPath, isAvatarFileName, userAvatarFolder } from "./paths";
import { validateAvatarFile } from "./validateFile";

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const FILE_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE = "https://abc.supabase.co/storage/v1/object/public/avatars";

describe("buildAvatarPath", () => {
  it("is profile-photos/{userId}/{uuid}.webp", () => {
    expect(buildAvatarPath(USER, FILE_UUID)).toBe(`profile-photos/${USER}/${FILE_UUID}.webp`);
    expect(userAvatarFolder(USER)).toBe(`profile-photos/${USER}`);
  });

  it("generates a different key on every call", () => {
    expect(buildAvatarPath(USER)).not.toBe(buildAvatarPath(USER));
  });
});

describe("isAvatarFileName", () => {
  it("accepts only {uuid}.webp", () => {
    expect(isAvatarFileName(`${FILE_UUID}.webp`)).toBe(true);
    expect(isAvatarFileName(`${FILE_UUID}.png`)).toBe(false);
    expect(isAvatarFileName("../x.webp")).toBe(false);
    expect(isAvatarFileName(`${FILE_UUID}.webp.exe`)).toBe(false);
    expect(isAvatarFileName(".emptyFolderPlaceholder")).toBe(false);
  });
});

describe("avatarPathFromUrl", () => {
  it("extracts the key from our public URL", () => {
    expect(avatarPathFromUrl(`${BASE}/profile-photos/${USER}/${FILE_UUID}.webp`, USER)).toBe(
      `profile-photos/${USER}/${FILE_UUID}.webp`
    );
  });

  it.each([
    ["null", null],
    ["empty string (email signups)", ""],
    ["a Google picture", "https://lh3.googleusercontent.com/a/abc=s96-c"],
    ["garbage", "not a url"],
    [
      "another bucket",
      `https://abc.supabase.co/storage/v1/object/public/product-images/profile-photos/${USER}/${FILE_UUID}.webp`,
    ],
    ["the old flat layout", `${BASE}/profile-photos/${USER}_${FILE_UUID}.webp`],
    ["a nested path", `${BASE}/profile-photos/${USER}/x/${FILE_UUID}.webp`],
  ])("returns null for %s", (_name, url) => {
    expect(avatarPathFromUrl(url, USER)).toBeNull();
  });

  it("never returns a key owned by someone else", () => {
    expect(avatarPathFromUrl(`${BASE}/profile-photos/${OTHER}/${FILE_UUID}.webp`, USER)).toBeNull();
  });

  it("rejects traversal, encoded traversal and a malformed user id", () => {
    expect(
      avatarPathFromUrl(`${BASE}/profile-photos/${USER}/../${OTHER}/${FILE_UUID}.webp`, USER)
    ).toBeNull();
    expect(avatarPathFromUrl(`${BASE}/profile-photos/${USER}/%2e%2e/x.webp`, USER)).toBeNull();
    expect(avatarPathFromUrl(`${BASE}/profile-photos/%zz`, USER)).toBeNull();
    expect(avatarPathFromUrl(`${BASE}/profile-photos/x/${FILE_UUID}.webp`, "x")).toBeNull();
  });
});

describe("validateAvatarFile", () => {
  const MB = 1024 * 1024;

  it("accepts JPEG, PNG and WebP up to 10 MB", () => {
    expect(validateAvatarFile({ type: "image/jpeg", size: 1 })).toBeNull();
    expect(validateAvatarFile({ type: "image/png", size: 5 * MB })).toBeNull();
    expect(validateAvatarFile({ type: "image/webp", size: 10 * MB })).toBeNull();
  });

  it("rejects other formats, empty files and files over 10 MB", () => {
    expect(validateAvatarFile({ type: "image/gif", size: 1000 })).toMatch(/formato/i);
    expect(validateAvatarFile({ type: "image/svg+xml", size: 1000 })).toMatch(/formato/i);
    expect(validateAvatarFile({ type: "", size: 1000 })).toMatch(/formato/i);
    expect(validateAvatarFile({ type: "image/png", size: 0 })).toMatch(/vacío/i);
    expect(validateAvatarFile({ type: "image/png", size: 10 * MB + 1 })).toMatch(/10 MB/);
  });
});
