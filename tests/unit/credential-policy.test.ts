import { describe, expect, it } from "vitest";
import {
  sanitizeCredentials,
  mergeCredentials,
  computeFreshness,
  isRefreshDegraded,
} from "../../src/core/credential-policy.js";

describe("credential-policy", () => {
  it("sanitizeCredentials removes empty refresh_token", () => {
    expect(sanitizeCredentials({ refresh_token: "", access_token: "a" })).toEqual({
      access_token: "a",
    });
  });

  it("mergeCredentials keeps existing refresh when incoming empty", () => {
    expect(
      mergeCredentials(
        { refresh_token: "rt_live", access_token: "old" },
        { refresh_token: "", access_token: "new" },
      ),
    ).toEqual({ refresh_token: "rt_live", access_token: "new" });
  });

  it("mergeCredentials omits refresh when both sides empty", () => {
    expect(mergeCredentials({}, { refresh_token: "" })).toEqual({});
  });

  it("mergeCredentials accepts non-empty incoming refresh rotation", () => {
    expect(
      mergeCredentials({ refresh_token: "rt_old" }, { refresh_token: "rt_new" }),
    ).toEqual({ refresh_token: "rt_new" });
  });

  it("mergeCredentials accepts access token rotation even when non-sensitive fields present", () => {
    expect(
      mergeCredentials(
        { refresh_token: "rt", access_token: "old_a" },
        { access_token: "new_a", expires_at: 123 },
      ),
    ).toEqual({ refresh_token: "rt", access_token: "new_a", expires_at: 123 });
  });

  it("computeFreshness uses the maximum among last_refresh and mtime signals (last_refresh wins when higher)", () => {
    expect(
      computeFreshness({
        grabData: { last_refresh: 5_000 },
        rawJson: {},
        fileMtimeMs: 2_000,
      }),
    ).toBe(5_000);
  });

  it("computeFreshness uses mtime when no last_refresh", () => {
    expect(
      computeFreshness({ grabData: {}, rawJson: {}, fileMtimeMs: 4_200 }),
    ).toBe(4_200);
  });

  it("computeFreshness ignores expires_at in credentials or raw (deadline is not freshness)", () => {
    expect(
      computeFreshness({
        grabData: {},
        rawJson: { expires_at: 9_999_999 },
        fileMtimeMs: 100,
      }),
    ).toBe(100);
  });

  it("computeFreshness returns 0 when no signals at all", () => {
    expect(
      computeFreshness({ grabData: {}, rawJson: {}, fileMtimeMs: NaN }),
    ).toBe(0);
  });

  it("isRefreshDegraded true when refresh missing or empty", () => {
    expect(isRefreshDegraded({})).toBe(true);
    expect(isRefreshDegraded({ refresh_token: "" })).toBe(true);
    expect(isRefreshDegraded({ refresh_token: "rt" })).toBe(false);
  });
});
