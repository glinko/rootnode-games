# Contributing a game

Anyone can fork this public repository and submit a pull request. A game becomes live only after the owner approves the PR, all checks pass, and the PR is merged into `main`. The server publishes `main` once per day, between 04:00 and 04:15 UTC.

1. Fork and create a branch.
2. Copy `templates/game/` to `games/your-game/`, or add your existing browser build there.
3. Include `index.html`, a cover image and a `LICENSE` file. Keep all required assets in that game folder and use relative asset URLs.
4. Append one entry to `games.json`, for example:

```json
{
  "slug": "your-game",
  "title": "Your Game",
  "description": "One or two sentences explaining the game.",
  "category": "Puzzle",
  "platform": "Mobile",
  "cover": "cover.svg",
  "author": "your-github-login",
  "license": "MIT"
}
```

5. Run `python scripts/build.py`, `python -m unittest discover -s tests -v`, and test the game on a phone. Build into a fresh output directory with `python scripts/build.py --output dist`, then serve locally as described in README.md.
6. Open a pull request with a screenshot and short test instructions. The owner reviews gameplay, rights to the assets and requested external network access, then approves and merges.

## Requirements

- Slugs use lowercase letters, digits and single hyphens, start with a letter, and remain unique. Existing URLs should not be renamed casually.
- Games are ready-to-play static HTML/CSS/JS/WebAssembly files. Server programs, package installation and game build commands are not run on the production server. Include a compiled build if your engine requires one.
- A file may be at most 25 MiB; the published catalogue may be at most 200 MiB. Keep games small enough for mobile users.
- Covers must be a local SVG, PNG, JPEG or WebP. Include licenses and credits for third-party artwork, music, fonts and libraries.
- No symlinks, hidden files, credentials, environment files or runtime level databases. Publish only assets you have permission to distribute.
- Disclose external services in the PR; games should work from their own URL prefix and must not register service workers above their own game path.
- Use touch-friendly controls and make replay/start controls usable without a desktop keyboard.

Manifest validation checks packaging, paths, file sizes and required files. It cannot replace a human gameplay or source review. Backend or deployment changes require a separate reviewed operations update; daily sync publishes static game files only.
