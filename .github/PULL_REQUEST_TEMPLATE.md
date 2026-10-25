<!--
  Keep it short. Reviewers care about: what changed, why, and how you know it works.
-->

## What changed

<!-- One paragraph. If it changes exported bytes, say so explicitly. -->

## Why

<!-- Link the issue if there is one: Closes #123 -->

## How it was verified

<!-- Delete what doesn't apply, keep the evidence. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Browser self-check (paste the summary line):

```
SELFCHECK: ...
```

## Checklist

- [ ] The card is still rendered by exactly one function (`scene()`); I did not add a second rendering path
- [ ] New UI strings exist in both `en` and `zh` (`src/i18n.ts`)
- [ ] Non-obvious decisions / measured numbers are in a code comment
- [ ] If exported output changed, I noted it above (users will see it)
