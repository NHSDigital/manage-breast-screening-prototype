# Working with Copilot on this repo

How to get good changes out of Copilot in VS Code here. The prototype has a lot of conventions, and Copilot knows them from the files in `.github/`, but only if it's used in the way below.

## Start a new chat for each task

Copilot works best with one task per chat. In a long chat it starts to lose track of the conventions and of what it did earlier, and quality drops without any warning. Start a new chat (the + button at the top of the chat panel):

- for each new task, even a small one
- when a chat has gone on for a long time or covered several things
- when Copilot starts undoing earlier work or repeating mistakes

A new chat can pick up where the old one left off: ask the old chat for a short summary of where things stand, then paste it into the new chat.

## Describe the change, not the code

Say what you want the page or journey to do, and which pages it affects. Its instructions tell it to read the docs for the area before changing anything. If it suggests adding a route, a new data field or some JavaScript, ask it why and whether something already does the job. It usually does.

## Review before every pull request

When a piece of work is finished, Copilot should review it without being asked. If it doesn't, type `/review-changes` in the chat.

The review is done by a separate agent that hasn't seen the chat, against the checklist in [review-checklist.md](review-checklist.md). Copilot then fixes what it found, runs the tests, and reviews again. At the end it gives you:

- a plain summary of what it found and fixed
- any questions for Ed
- review notes to paste into the pull request description

You don't need to understand every finding. The fixes are the point, and the notes let Ed see what happened when he's back.

If a review suggests a big change to how the feature works, Copilot should ask you first. If you're unsure, leave it as a question for Ed in the review notes.

## Committing and pull requests

- Work on a branch, never on `main`.
- Commit after the review, with a message saying what changed.
- To bring in changes from `main`, merge `main` into your branch. If there are conflicts, start a new chat and ask Copilot to resolve them.
- Fill in the pull request template: what it changes, the review notes, and the checklist.
- Copilot reviews each pull request on GitHub and may leave comments. To deal with them, start a new chat and type `/pr-comments`. Copilot fixes what's valid, replies to each comment, and resolves the fixed ones. Comments it disagrees with stay open with a reply for Ed.
- For Copilot to reply and resolve on GitHub, it needs the GitHub CLI: install it from [cli.github.com](https://cli.github.com) and run `gh auth login` once. Without it, Copilot will tell you which comments are fixed, and you can press "Resolve conversation" on each.
- Merge with **Squash and merge**.

## If something goes wrong

- Tests failing: ask Copilot to run `npm test`, explain the failure and fix it. Don't merge with failing tests.
- A page errors or looks wrong: tell Copilot which page and what you see, and ask it to check the running app.
- Copilot keeps going round in circles: start a new chat with a short summary of the problem.
