import assert from "node:assert/strict";
import test from "node:test";

import { verifyReleaseContract } from "./verify-release.mjs";

const validContract = {
  tag: "v0.1.0-alpha.2",
  packageVersion: "0.1.0-alpha.2",
  lockVersion: "0.1.0-alpha.2",
  sourceVersion: "0.1.0-alpha.2",
  publishAccess: "public",
  publishTag: "alpha"
};

test("accepts an aligned public alpha release", () => {
  assert.doesNotThrow(() => verifyReleaseContract(validContract));
});

test("rejects a tag that does not match the package version", () => {
  assert.throws(
    () => verifyReleaseContract({ ...validContract, tag: "v0.1.0-alpha.3" }),
    /release tag.*must equal/
  );
});

test("reports every drifted version boundary", () => {
  assert.throws(
    () => verifyReleaseContract({
      ...validContract,
      packageVersion: "0.1.0-alpha.3",
      lockVersion: "0.1.0-alpha.1",
      sourceVersion: "0.1.0-alpha.4"
    }),
    (error) => {
      assert.match(error.message, /release tag/);
      assert.match(error.message, /lockfile version/);
      assert.match(error.message, /source version/);
      return true;
    }
  );
});

test("rejects stable or privately configured releases", () => {
  assert.throws(
    () => verifyReleaseContract({
      ...validContract,
      tag: "v1.0.0",
      packageVersion: "1.0.0",
      lockVersion: "1.0.0",
      sourceVersion: "1.0.0",
      publishAccess: "restricted",
      publishTag: "latest"
    }),
    (error) => {
      assert.match(error.message, /alpha version/);
      assert.match(error.message, /publish access/);
      assert.match(error.message, /publish tag/);
      return true;
    }
  );
});
