import { describe, expect, it } from "vitest";
import { classifyHttpError, ExitCode, isNotFound, redact } from "../src/errors.js";

describe("redaction", () => {
  it("removes credentials and signed URL values recursively", () => {
    const value = redact({ authorization: "Bearer secret", key: "plain-key", nested: { apiKey: "sk-abcdefghijk", url: "https://x.test/a?X-Amz-Signature=secret&token=abc" } });
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(JSON.stringify(value)).not.toContain("abcdefghijk");
    expect(JSON.stringify(value)).not.toContain("token=abc");
    expect(JSON.stringify(value)).not.toContain("plain-key");
    expect(redact("Authorization: Bearer $WOWIDEA_API_KEY")).toBe("Authorization: Bearer $WOWIDEA_API_KEY");
  });

  it("maps conflicts to the documented exit code", () => {
    const error = classifyHttpError(409, { message: "stale" });
    expect(error.exitCode).toBe(ExitCode.Conflict);
    expect(error.message).toContain("baseVersion");
  });

  // Optional endpoints such as /v1/images/preflight may be absent, and the server
  // replaces the generic "HTTP 404" text with its own message.
  it("detects a missing optional endpoint from the response body", () => {
    expect(isNotFound(classifyHttpError(404, { statusCode: 404, message: "Cannot POST /v1/images/preflight", diagnosticCode: "NotFoundException" }))).toBe(true);
    expect(isNotFound(classifyHttpError(404, { message: "Cannot POST /v1/images/preflight" }))).toBe(true);
    expect(isNotFound(classifyHttpError(422, { statusCode: 422, message: "invalid" }))).toBe(false);
    expect(isNotFound(new Error("HTTP 404"))).toBe(false);
  });
});
