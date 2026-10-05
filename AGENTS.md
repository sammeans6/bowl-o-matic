# Instructions for AI coding agents (Codex, Claude, others)

The app is **locked with the owner's code (PIN)**. The repo and the live site are public, so
the source (`js/`, `css/`, `test/`, `docs/`) is committed only in encrypted form as `app.bin`.
`lock.js` shows a keypad, decrypts `app.bin` in the browser and starts the app.

**The PIN is never written in this repo, in memory notes or anywhere else. Ask Sam for it.**

1. Unlock the source: `BOWL_PIN=<code> node tools/bundle.mjs unlock` (writes `js/ css/ test/ docs/`, and the 18+ clips into `clips-src/`, all git-ignored).
2. Read in full: `docs/BOWL-O-MATIC_PROJECT_BRIEF_FOR_AI_AGENTS_2026-10-03.md` and
   `docs/BOWL-O-MATIC_SECURITY_REVIEW_AND_ACCESS_CHECKLIST_2026-10-03.md`.
3. After any change to those folders: `BOWL_PIN=<code> node tools/bundle.mjs lock`, then run the tests
   (the browser tests type `BOWL_PIN` into the lock screen), bump `CACHE` in `sw.js`, and commit `app.bin`.
   Check `git status`: no readable source, photos or videos may be committed.

Hard rules:
- Never commit the owner's photos, videos, screen recordings or animation clips. Clips need his explicit approval first.
- The bar for pin detection is **zero wrong throws**. Run `node --test test/core.test.mjs` and the e2e demo test before every deploy.
- Bump `CACHE` in `sw.js` on every deploy. Pushing to `main` deploys to https://sammeans6.github.io/bowl-o-matic/.
