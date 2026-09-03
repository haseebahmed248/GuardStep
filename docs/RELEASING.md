# Releasing GuardStep

GuardStep alpha releases are published from GitHub Actions with npm trusted publishing. The workflow does not use a long-lived npm write token.

## One-time repository setup

Create the `npm-release` GitHub environment and require a maintainer approval before deployment.

On the npm package settings page, configure a GitHub Actions trusted publisher with these exact values:

- organization or user: `haseebahmed248`
- repository: `GuardStep`
- workflow filename: `publish.yml`
- environment: `npm-release`
- allowed action: `npm publish`

After a trusted release succeeds, set npm publishing access to require two-factor authentication and disallow bypass tokens.

## Publish an alpha

1. Update the same version in `packages/guardstep/package.json`, `package-lock.json`, and `packages/guardstep/src/version.ts`.
2. Run `npm run check:release -- v<version>` and the normal validation commands.
3. Merge the version change through a reviewed pull request.
4. Tag the merged `main` commit with `v<version>` and push the tag.
5. Review the `npm-release` deployment and approve it only after the preflight job passes.

The workflow verifies the tag and all version boundaries, tests the package, publishes with the `alpha` dist-tag, and creates a matching GitHub prerelease. npm generates provenance automatically for the trusted GitHub Actions publication.
