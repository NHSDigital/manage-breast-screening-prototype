---
name: review-changes
description: Review the current change against this prototype's conventions, fix what the review finds, and write review notes for the pull request. Use when a piece of work is finished, before committing or opening a pull request, or when asked to review, check or tidy up a change.
---

# Review changes

Check the work against this repo's conventions with fresh eyes, fix what is wrong, and leave a clear record for whoever reviews the pull request. The authors are designers whose background is not coding, so do not hand code problems back to them: fix them, and explain in plain language what you did.

## 1. Get ready

- If the branch is well behind `main`, suggest merging `main` in first, so the review uses the current conventions and docs.
- Write two or three sentences on what the change is meant to do. The reviewer needs this to judge whether it does it.

## 2. Review in a subagent

Run the `code-reviewer` agent as a subagent. Give it:

- what the change is meant to do
- any files or areas you know are affected beyond the obvious ones

A subagent has not seen the reasoning behind the change, which is what makes it useful: it judges the code as it is. If you cannot run subagents, do the review yourself: read [docs/review-checklist.md](../../../docs/review-checklist.md), then read the whole change again as if someone else had written it, and work through every section.

## 3. Fix

- Fix every **must fix** finding and every **should fix** finding that is quick and safe.
- Fix at the root. If a finding shows the same mistake in several places, fix every place, and search the repo for others.
- Keep behaviour the same unless the finding is that the behaviour is wrong. Before a larger fix (merging routes, moving logic into a helper, renaming a data key), note what currently works so you can confirm it still does.
- Do not decide **ask Ed** items. Leave them for the review notes.
- If a fix would mean redesigning the feature, stop and explain the choice to the designer instead.
- After renaming anything, search the whole repo for the old name.

## 4. Check again

- Run `npm test`. Fix anything the change broke.
- Run the `code-reviewer` subagent again, passing it the previous report so it re-checks each finding. Fix anything new. Stop after two rounds of fixes and report what is left.
- Look at the changed pages in the running app if you can.

## 5. Report back

Tell the designer, in plain language and briefly:

- what the review found and what you fixed
- anything left unfixed and why
- questions for Ed

Then give them review notes to paste into the pull request description, as a fenced markdown block:

```markdown
## Review notes

- Reviewed with the review-changes skill. `npm test`: passing
- Fixed: [one line per fix]
- Not fixed: [item and reason, or "nothing"]
- For Ed: [questions or judgement calls, or "nothing"]
- Data changes: [keys, fields or statuses added or changed, and the other places that use them]
```

Do not commit unless asked. If this chat has already covered several tasks or become long, suggest starting a new chat for the next piece of work.
