---
layout: default
title: "Private Modules"
parent: "How To"
description: "Configure Go private modules for GitHub and GitLab private repositories in ColdBrew services"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

When your service depends on private Go modules (e.g., shared libraries in a private GitHub org or GitLab group), Go needs two things:

1. **GOPRIVATE** — tells `go` to skip the public module proxy and fetch directly from the source
2. **Authentication** — credentials to access private repositories

ColdBrew's cookiecutter template pre-configures GOPRIVATE from the `goprivate` variable you set during project creation (defaults to `source_path/*`). You just need to set up authentication.

## Local Development

### Option 1: SSH key (recommended)

If you already have SSH access to your repos:

```bash
git config --global url."git@github.com:".insteadOf "https://github.com/"
# Or for GitLab:
git config --global url."git@gitlab.com:".insteadOf "https://gitlab.com/"
```

### Option 2: Personal access token via .netrc

```bash
# GitHub
echo "machine github.com login x-access-token password YOUR_PAT" >> ~/.netrc

# GitLab (needs read_repository scope)
echo "machine gitlab.com login your-username password YOUR_PAT" >> ~/.netrc
```

### Option 3: GOAUTH

```bash
export GOAUTH=netrc
```

This tells Go to use `.netrc` for authentication during module resolution.

## Docker Builds

The generated `Dockerfile` includes GOPRIVATE as a build arg. For authentication, uncomment one of the options in the Dockerfile:

### Personal access token

```bash
docker build --build-arg GITHUB_TOKEN=your_pat .
```

The Dockerfile has a commented-out section that uses this arg to create a `.netrc` file in the build stage. Since ColdBrew uses a multi-stage build, credentials in the build stage are **not** included in the final image.

For even stronger isolation, use a BuildKit secret mount instead of a build arg:

```bash
docker build --secret id=netrc,src=$HOME/.netrc .
```

### SSH agent forwarding

For SSH-based auth during Docker builds, use BuildKit:

```bash
DOCKER_BUILDKIT=1 docker build --ssh default .
```

Add to your Dockerfile build stage:

```dockerfile
RUN --mount=type=ssh git config --global url."git@github.com:".insteadOf "https://github.com/"
```

## GitHub Actions

The generated workflow includes GOPRIVATE in the `env` section. For authentication, uncomment the private modules step and add a `GO_PRIVATE_TOKEN` secret to your repo:

1. Create a [GitHub PAT](https://github.com/settings/tokens) with `repo` scope
2. Add it as a repository secret named `GO_PRIVATE_TOKEN`
3. Uncomment the "Configure private modules" step in `.github/workflows/go.yml`

## GitLab CI

The generated `.gitlab-ci.yml` includes GOPRIVATE in the variables. For authentication, uncomment the `.netrc` line in `before_script`:

```yaml
before_script:
  - mkdir -p .go/pkg/mod
  - echo "machine gitlab.com login gitlab-ci-token password ${CI_JOB_TOKEN}" > ~/.netrc
```

`CI_JOB_TOKEN` is automatically available in GitLab CI — no manual token setup needed.

### GitLab nested subgroups

GitLab projects nested more than one level deep (e.g., `gitlab.com/org/group/subgroup/repo`) require special handling because Go's module discovery makes unauthenticated HTTP requests to determine the repository path.

Use GOAUTH with `.netrc`:

```yaml
variables:
  GOAUTH: "netrc"
```

Also set `GONOSUMDB` and `GONOPROXY` alongside GOPRIVATE to ensure Go doesn't try the public checksum database or proxy for nested subgroup paths.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `410 Gone` | Module proxy can't access private repo | Ensure GOPRIVATE is set correctly |
| `404 Not Found` | Git can't authenticate | Check `.netrc` or SSH config |
| `remote: HTTP Basic: Access denied` | Token expired or wrong scope | Regenerate PAT with `repo` (GitHub) or `read_repository` (GitLab) scope |
| `could not read Username` | Git prompting for credentials in non-interactive mode | Add `.netrc` or SSH config — don't rely on interactive auth in CI/Docker |
