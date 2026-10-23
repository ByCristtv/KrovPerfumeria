// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PROFILE_SELF_EDITABLE_COLUMNS } from "./editableColumns";

/**
 * Security guard for the profiles privilege hardening
 * (migration 20261023000100). The database is what actually enforces it — see
 * supabase/tests/20261023000100_profiles_privilege_hardening_test.sql for the
 * role-switching tests against Postgres. These checks keep the APP honest:
 *
 *   1. the TS allowlist, the migration's GRANT and its guard trigger agree;
 *   2. no direct `.from("profiles")` write in the codebase touches a column
 *      outside the allowlist, and nothing inserts/upserts/deletes profiles.
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20261023000100_profiles_privilege_hardening.sql"),
  "utf8"
);

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("profile self-edit allowlist", () => {
  it("matches the migration's GRANT UPDATE column list", () => {
    const grant = MIGRATION.match(
      /GRANT UPDATE \(([^)]+)\)\s+ON public\.profiles TO authenticated;/
    );
    expect(grant, "GRANT UPDATE (...) not found in the migration").not.toBeNull();
    const cols = grant![1].split(",").map((c) => c.trim());
    expect(sorted(cols)).toEqual(sorted(PROFILE_SELF_EDITABLE_COLUMNS));
  });

  it("matches the guard trigger's v_allowed (plus updated_at)", () => {
    const allowed = MIGRATION.match(/ARRAY\[([^\]]+)\];/);
    expect(allowed, "v_allowed not found in the migration").not.toBeNull();
    const cols = allowed![1].split(",").map((c) => c.trim().replace(/'/g, ""));
    expect(sorted(cols)).toEqual(sorted([...PROFILE_SELF_EDITABLE_COLUMNS, "updated_at"]));
  });

  it("never lists a privileged column", () => {
    for (const col of [
      "role",
      "experience_points",
      "id",
      "created_at",
      "updated_at",
      "is_profile_public",
    ]) {
      expect(PROFILE_SELF_EDITABLE_COLUMNS as readonly string[]).not.toContain(col);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source scan
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_DIRS = ["app", "components", "features", "hooks", "lib", "store", "stores", "proxy.ts"];
const SOURCE = /\.(ts|tsx)$/;
const SKIP = /(\.test\.|\.spec\.|[\\/]node_modules[\\/]|[\\/]\.next[\\/])/;

function walk(path: string, out: string[] = []): string[] {
  let st;
  try {
    st = statSync(path);
  } catch {
    return out;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
  } else if (SOURCE.test(path) && !SKIP.test(path)) {
    out.push(path);
  }
  return out;
}

interface ProfileWrite {
  file: string;
  method: string;
  /** Keys of the object literal, or null when the payload isn't a literal. */
  keys: string[] | null;
}

/** Find `.from("profiles").<write>(...)` chains and the keys they write. */
function findProfileWrites(source: string, file = "<inline>"): ProfileWrite[] {
  const writes: ProfileWrite[] = [];
  const re = /\.from\(\s*["'`]profiles["'`]\s*\)\s*\.(update|upsert|insert|delete)\(\s*(\{[^}]*\})?/g;
  for (const m of source.matchAll(re)) {
    const body = m[2];
    const keys = body
      ? body
          .slice(1, -1)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => part.split(":")[0].trim().replace(/["']/g, ""))
      : null;
    writes.push({ file, method: m[1], keys });
  }
  return writes;
}

describe("direct profile writes in the codebase", () => {
  const writes = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir))).flatMap((file) =>
    findProfileWrites(readFileSync(file, "utf8"), relative(ROOT, file))
  );

  it("finds the known self-edit call sites (scan is not vacuous)", () => {
    const files = writes.map((w) => w.file.replace(/\\/g, "/"));
    expect(files).toEqual(
      expect.arrayContaining([
        "app/api/profile/avatar/route.ts",
        "app/profile/actions.ts",
        "features/account/getAccountData.ts",
      ])
    );
  });

  it("only ever UPDATEs — never inserts, upserts or deletes profiles", () => {
    expect(writes.filter((w) => w.method !== "update")).toEqual([]);
  });

  it("only writes allowlisted columns, as object literals", () => {
    for (const w of writes) {
      expect(w.keys, `${w.file}: profile update payload must be an object literal`).not.toBeNull();
      for (const key of w.keys!) {
        expect(
          PROFILE_SELF_EDITABLE_COLUMNS as readonly string[],
          `${w.file} writes profiles.${key}, which customers cannot update`
        ).toContain(key);
      }
    }
  });

  it("detects a forbidden write (self-test of the scanner)", () => {
    const sample = `await supabase.from("profiles").update({ phone, role: "admin" }).eq("id", id);`;
    const [w] = findProfileWrites(sample);
    expect(w.keys).toEqual(["phone", "role"]);
    expect(PROFILE_SELF_EDITABLE_COLUMNS as readonly string[]).not.toContain("role");
  });

  it("tolerates the `satisfies ProfileSelfUpdate` annotation", () => {
    const sample = `.from("profiles")\n    .update({ phone } satisfies ProfileSelfUpdate)`;
    expect(findProfileWrites(sample)[0].keys).toEqual(["phone"]);
  });
});
