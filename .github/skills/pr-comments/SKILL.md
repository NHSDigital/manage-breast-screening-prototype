---
name: pr-comments
description: Deal with review comments on a pull request - fix what is valid, reply to each thread, and resolve the fixed ones. Use when asked to deal with, fix or respond to pull request comments, including Copilot's code review.
---

# Pull request comments

Work through the open review threads on a pull request: from Copilot's code review or from a person.

## Rules

- **Reply, then resolve.** Never resolve a thread without replying first: a resolved thread is collapsed, and the reply is the only record of what happened.
- **Fixed:** reply with the commit and a one-line note of what changed, then resolve.
- **Not applicable, or you disagree:** reply with the reason and leave the thread open for Ed.
- **Replies post under the user's GitHub account.** Write them as short, plain notes from that person: what changed and where. No greetings or sign-offs.
- Fix at the root, as in the `review-changes` skill: if a comment points at a pattern, fix every instance, then run `npm test`.

## Steps

1. Check the GitHub CLI is available: `gh auth status`. If it is not installed or not signed in, skip the commands below. Fix what you can, then tell the designer which comments are fixed so they can reply and press "Resolve conversation" on GitHub.
2. Find the pull request number: `gh pr view --json number --jq .number`.
3. List the open threads:

   ```sh
   gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved path comments(first: 20) { nodes { databaseId author { login } body } } } } } } }' -f owner=NHSDigital -f repo=manage-breast-screening-prototype -F number=NUMBER --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
   ```

   Each thread's `id` is used to resolve it. The first comment's `databaseId` is used to reply.
4. Fix the valid comments, run `npm test`, commit and push. Ask before pushing if the designer has not already said to.
5. Reply to each thread:

   ```sh
   gh api repos/NHSDigital/manage-breast-screening-prototype/pulls/NUMBER/comments/COMMENT_ID/replies -f body='Fixed in abc1234: the review notes now record the actual test result.'
   ```

6. Resolve the fixed ones:

   ```sh
   gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' -f id=THREAD_ID
   ```

7. Tell the designer what was fixed, what was left open and why.
