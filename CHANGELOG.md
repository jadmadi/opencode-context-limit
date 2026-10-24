# Changelog

Notable changes to opencode-context-limit. Versions use CalVer (YYYY.MM.MICRO).

## 2026.10.2

- Add `/output-limit` for a per-model max output-token budget. The rule engine
  now targets `limit.context` or `limit.output`, with separate rule sets.
- Credit to Elijah Shaw-Rutschman (@elijahwander) for the original patch.

## 2026.10.1

- Verified against OpenCode 2.1.4. No behavior change.

## 2026.10.0

- Use `Plugin.define` from the host `@opencode/plugin` module.
- Test against OpenCode 2.1.3.

## 2026.9.0

- Adopted CalVer. Supersedes the 0.1.3 release.

