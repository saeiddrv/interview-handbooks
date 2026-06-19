---
title: "Git — Complete Mastery Handbook"
description: "A complete, unshortened guide to Git: from how it works under the hood to the most advanced real-world usage — branching, rebasing, worktrees, submodules,…"
sidebar:
  label: "Git"
---

> A complete, unshortened guide to Git: from how it works under the hood to the most advanced
> real-world usage — branching, rebasing, worktrees, submodules, hooks, recovery, team workflows,
> GitHub/GitLab groups, and interview Q&A. Real commands, real examples, nothing skipped.
>

---

## 1. How Git Works Under the Hood (the mental model)

Most Git confusion disappears once you understand that **Git is a content-addressable filesystem**
with a version-control UI on top. Internally, Git stores **four kinds of objects** in `.git/objects/`,
each named by the SHA-1 (now also SHA-256) hash of its content:

| Object | What it is |
|---|---|
| **blob** | The raw contents of a file (no name, no metadata — just bytes). |
| **tree** | A directory listing: maps filenames → blob/tree hashes (like a folder). |
| **commit** | A snapshot: points to one tree + parent commit(s) + author + message. |
| **tag** | An annotated tag object: points to a commit + tagger + message. |

**Key insight:** A commit is **not a diff** — it's a full **snapshot** of the whole tree. Git is
efficient because identical files share the same blob (deduplicated by hash).

**Refs** are just pointers (text files) to commit hashes:
- A **branch** (`refs/heads/main`) = a movable pointer to the latest commit.
- A **tag** (`refs/tags/v1.0`) = usually a fixed pointer.
- **HEAD** = a pointer to "where you are now" (usually points to a branch).

**The three areas you constantly move files between:**

```
 Working Directory  ──git add──▶  Staging Area (Index)  ──git commit──▶  Repository (.git)
   (your files)                    (the next snapshot)                    (permanent history)
```

> **Real example — peek inside Git:**
> ```bash
> git cat-file -p HEAD          # show the commit object (tree, parent, author)
> git cat-file -p HEAD^{tree}   # show the directory listing it points to
> git rev-parse HEAD            # the full SHA of the current commit
> ```

---

## 2. Core Daily Workflow

```bash
git init                      # start a new repo in the current folder
git clone <url>               # copy a remote repo locally
git status                    # what's changed / staged
git add file.txt              # stage one file
git add -p                    # stage *parts* of files interactively (hunk by hunk)
git add .                     # stage everything in the current dir
git commit -m "message"       # snapshot the staged changes
git commit -am "message"      # add (tracked files) + commit in one step
git log --oneline --graph --all   # readable history of all branches
git diff                      # unstaged changes
git diff --staged             # staged changes (what will be committed)
```

> **Pro tip — `git add -p`** is the single most underused command. It lets you split one messy file
> of changes into clean, logical commits by staging only the hunks you choose (`y`/`n`/`s` to split).

---

## 3. Branching & Merging

A branch is cheap — just a pointer. Create one per feature.

```bash
git branch                       # list local branches
git switch -c feature/login      # create + switch (modern, preferred)
git checkout -b feature/login    # older equivalent
git switch main                  # switch back
git branch -d feature/login      # delete a merged branch
git branch -D feature/login      # force-delete (unmerged)
```

### Merging
Bring another branch's work into your current branch.

```bash
git switch main
git merge feature/login
```

**Two kinds of merge:**

- **Fast-forward:** If `main` hasn't moved, Git just slides the pointer forward — **no merge commit**.
- **Three-way merge:** If both branches advanced, Git creates a **merge commit** with two parents.

```bash
git merge --no-ff feature/login   # always create a merge commit (keeps feature grouping visible)
git merge --squash feature/login  # combine all feature commits into ONE staged change, then commit
git merge --abort                 # bail out of a conflicted merge
```

### Resolving merge conflicts
When the same lines changed on both sides, Git pauses and marks the file:
```
<<<<<<< HEAD
your version
=======
their version
>>>>>>> feature/login
```
Edit the file to the correct result, remove the markers, then:
```bash
git add conflicted_file.txt
git commit                       # completes the merge
# helpful tools:
git mergetool                    # open a visual merge tool
git checkout --ours  file.txt    # keep our side entirely
git checkout --theirs file.txt   # keep their side entirely
```

---

## 4. Rebasing & Rewriting History

**Rebase = replay your commits on top of another base.** It produces a clean, **linear** history (no
merge commits) — but it **rewrites commit hashes**, so never rebase shared/public history that others
have pulled.

```bash
git switch feature/login
git rebase main          # replay feature commits on top of latest main
git rebase --continue    # after resolving a conflict
git rebase --abort       # cancel and go back
```

### Merge vs Rebase — the golden rule
- **Merge:** preserves exactly what happened (true history, with merge commits). Safe for shared
  branches.
- **Rebase:** rewrites history into a clean line. Use it on **your own local** branch before sharing.
- **Common team pattern:** rebase your feature branch onto `main` to stay current, then open a PR.

### Interactive rebase (the power tool)
Rewrite the last N commits — reorder, squash, edit, drop, reword:
```bash
git rebase -i HEAD~5
```
You get an editor:
```
pick   a1b2c3 Add login form
squash 4d5e6f Fix typo            # fold into previous commit
reword 7g8h9i Add validation      # change the message
edit   0j1k2l Refactor auth       # pause here to amend
drop   3m4n5o Debug print         # remove this commit entirely
```
Commands: `pick` (keep), `reword` (change message), `edit` (pause to amend), `squash` (merge + keep
both messages), `fixup` (merge + discard message), `drop` (delete), and reorder lines to reorder
commits.

> **Real example — clean up before a PR:** You made 8 messy commits ("wip", "fix", "oops"). Run
> `git rebase -i main`, mark the noise as `fixup`, reword the main one, and present **one clean
> commit**.

### Amend the last commit
```bash
git commit --amend                    # change message or add staged files to the last commit
git commit --amend --no-edit          # add forgotten files without changing the message
```

### Autosquash (surgical fixups)
```bash
git commit --fixup=<commit-sha>       # marks a commit as a fixup of an older one
git rebase -i --autosquash main       # automatically orders & folds the fixups
```

> **Safety:** When you must push rewritten history to your own branch, use
> **`git push --force-with-lease`** (refuses to clobber someone else's new work) instead of the
> dangerous `--force`.

---

## 5. Cherry-pick, Revert, Reset & Restore

### `cherry-pick` — copy a single commit onto your branch
```bash
git cherry-pick a1b2c3d               # apply that one commit here
git cherry-pick a1b2c3d^..f4g5h6i     # a range of commits
git cherry-pick -x a1b2c3d            # record "cherry picked from..." in the message
```
> **Real example — hotfix:** A bug fix landed on `main` but you need it on the `release/1.4` branch
> too. `git switch release/1.4 && git cherry-pick <fix-sha>`.

### `revert` — safely undo a commit in PUBLIC history
Creates a **new** commit that reverses an old one (doesn't rewrite history → safe for shared
branches).
```bash
git revert a1b2c3d                    # make a new commit that undoes a1b2c3d
git revert -m 1 <merge-sha>           # revert a merge commit (keep parent #1)
```

### `reset` — move the branch pointer (rewrites local history)
```bash
git reset --soft  HEAD~1   # undo last commit, KEEP changes staged
git reset --mixed HEAD~1   # (default) undo last commit, keep changes unstaged
git reset --hard  HEAD~1   # undo last commit, DISCARD changes  destructive
```

| Mode | Moves branch? | Keeps changes? | Where? |
|---|---|---|---|
| `--soft` | Yes | | staged |
| `--mixed` | Yes | | working dir (unstaged) |
| `--hard` | Yes | No | gone (recoverable via reflog for a while) |

### `restore` — modern file-level undo
```bash
git restore file.txt                  # discard unstaged changes to a file
git restore --staged file.txt         # unstage a file (keep the edits)
git restore --source=HEAD~2 file.txt  # bring back an old version of one file
```

> **revert vs reset (interview classic):** Use **revert** on commits already pushed/shared (it adds a
> new undo commit). Use **reset** only on local, unshared commits (it rewrites history).

---

## 6. Stash — shelving work in progress

Temporarily set aside uncommitted changes to switch context quickly.

```bash
git stash                       # shelve tracked changes, clean the working dir
git stash -u                    # include untracked files
git stash push -m "wip: login"  # named stash
git stash list                  # see all stashes
git stash show -p stash@{0}     # view a stash's diff
git stash pop                   # re-apply the latest stash AND remove it
git stash apply stash@{1}       # re-apply a specific stash, KEEP it in the list
git stash branch fix-x stash@{0} # turn a stash into a new branch
git stash drop stash@{0}        # delete one stash
git stash clear                 # delete all stashes
```

> **Real example:** You're mid-feature when an urgent bug comes in. `git stash`, fix the bug on a
> clean tree, commit, then `git stash pop` to continue exactly where you left off.

---

## 7. Undo & Recovery (reflog — your time machine)

**The reflog records every place HEAD has been** — even after a "lost" reset, rebase, or deleted
branch. This is how you recover from almost any mistake.

```bash
git reflog                      # list everywhere HEAD has pointed, with timestamps
git reflog show feature/login   # reflog for a specific branch
```
Example output:
```
a1b2c3d HEAD@{0}: reset: moving to HEAD~3
f4g5h6i HEAD@{1}: commit: Add validation   ← the work you thought you lost
```
Recover it:
```bash
git reset --hard f4g5h6i        # jump back to that exact state
# or recover a deleted branch:
git switch -c recovered f4g5h6i
```

> **Real example — "I hard-reset and lost 3 commits!":** `git reflog`, find the hash from before the
> reset, `git reset --hard <hash>`. Crisis averted. Reflog entries live ~90 days by default.

Other recovery tools:
```bash
git fsck --lost-found           # find dangling/unreachable commits
git cherry-pick <dangling-sha>  # bring an orphaned commit back
```

---

## 8. Multiple Workspaces (worktrees)

A **worktree** lets you check out **multiple branches at once into separate folders**, all sharing the
**same `.git`** repo — no second clone, no stashing to switch context.

```bash
git worktree add ../project-hotfix hotfix/urgent   # new folder on the hotfix branch
git worktree add ../project-review pr-123           # review a PR in its own folder
git worktree list                                   # show all worktrees
git worktree remove ../project-hotfix               # clean up when done
git worktree prune                                  # tidy stale entries
```

> **Real example — why this is gold:** You're deep in a feature with a dirty working dir, and a
> production bug lands. Instead of stashing and switching branches, run
> `git worktree add ../app-hotfix main`, fix and deploy from that folder, then delete it — your
> feature folder stays **completely untouched.** Great for running tests on one branch while coding
> on another.

**Rules:** the same branch can't be checked out in two worktrees simultaneously; all worktrees share
branches, stashes, and config from the one repo.

---

## 9. Remotes, Fetch, Pull & Push

A **remote** is a named reference to another copy of the repo (e.g., on GitHub).

```bash
git remote -v                         # list remotes
git remote add origin <url>           # add the main remote
git remote add upstream <url>         # add the original repo (in a fork workflow)
git remote rename origin gh
git remote set-url origin <new-url>
```

### Fetch vs Pull (important distinction)
```bash
git fetch origin            # download new commits, DON'T touch your working branch
git pull                    # = fetch + merge (or rebase) into your branch
git pull --rebase           # fetch, then replay your commits on top (linear history)
```
> **Fetch is safe and read-only** — it just updates your knowledge of the remote. **Pull modifies
> your branch.** Many teams default to `pull --rebase` to avoid noisy merge commits:
> `git config --global pull.rebase true`.

### Pushing
```bash
git push -u origin feature/login      # push & set upstream (first time)
git push                              # subsequent pushes
git push --force-with-lease           # safely push rewritten history (your branch)
git push origin --delete old-branch   # delete a remote branch
git push --tags                       # push tags
```

### Tracking branches
```bash
git branch -vv                        # show which remote each local branch tracks
git branch -u origin/main             # set upstream for the current branch
```

### The fork workflow (open source)
```bash
git clone <your-fork>
git remote add upstream <original-repo>
git fetch upstream
git rebase upstream/main              # keep your fork current with the original
git push --force-with-lease           # update your fork's branch
```

---

## 10. Tags & Releases

```bash
git tag v1.0.0                        # lightweight tag (just a pointer)
git tag -a v1.0.0 -m "Release 1.0"    # annotated tag (recommended: has author/date/message)
git tag -s v1.0.0 -m "Signed"         # GPG-signed tag
git tag                               # list tags
git show v1.0.0                       # view a tag
git push origin v1.0.0                # push one tag
git push origin --tags                # push all tags
git tag -d v1.0.0                     # delete locally
git push origin --delete v1.0.0       # delete on remote
git checkout v1.0.0                   # check out the code at that tag (detached HEAD)
```
> **Annotated vs lightweight:** Use **annotated** tags for releases — they're real objects with
> metadata and can be signed. Lightweight tags are just bookmarks for private/temporary use.

---

## 11. Submodules vs Subtrees (projects inside projects)

Both let you embed one repo inside another (e.g., a shared library).

### Submodules — a *pointer* to a specific commit of another repo
```bash
git submodule add <url> libs/shared       # add a submodule
git clone --recurse-submodules <url>      # clone a repo + its submodules
git submodule update --init --recursive   # fetch submodule contents after a normal clone
git submodule update --remote             # bump submodules to their latest remote commit
cd libs/shared && git pull origin main    # update a submodule manually, then commit the new pointer
```
- **Pros:** keeps histories separate; the parent records an exact commit of the child.
- **Cons:** notoriously fiddly — easy to forget `--recurse-submodules`, detached HEADs inside, extra
  steps for everyone.

### Subtrees — actually *merge* another repo's files into yours
```bash
git subtree add    --prefix=libs/shared <url> main --squash
git subtree pull   --prefix=libs/shared <url> main --squash
git subtree push   --prefix=libs/shared <url> main
```
- **Pros:** no special commands for cloners (files are just there); simpler for teammates.
- **Cons:** bigger repo; contributing changes back upstream is more involved.

> **Rule of thumb:** Use **submodules** when the embedded repo is independently versioned and you want
> a precise pinned commit. Use **subtrees** when you mostly want the files vendored in with minimal
> hassle for everyone cloning.

---

## 12. Inspecting & Searching History

```bash
git log --oneline --graph --all --decorate    # the everyday "map" of the repo
git log -p file.txt                           # full diff history of one file
git log --follow file.txt                     # follow a file across renames
git log -S "functionName"                     # "pickaxe": commits that added/removed that text
git log -G "regex"                            # commits whose diff matches a regex
git log --author="Saeid" --since="2 weeks ago"
git log main..feature                         # commits on feature not in main
git shortlog -sn                              # contributor commit counts

git blame file.txt                            # who last changed each line
git blame -L 10,20 file.txt                   # blame a line range
git show <commit>                             # full details + diff of a commit
git diff main..feature                        # compare two branches
git diff --stat                               # summary of changed files
```
> **Real example — find when a bug text appeared:** `git log -S "buggyConfig = true"` jumps straight
> to the commit that introduced that exact string. The "pickaxe" is a lifesaver.

---

## 13. `bisect` — hunting a bug automatically

Binary-search your history to find the exact commit that introduced a bug.

```bash
git bisect start
git bisect bad                 # current commit is broken
git bisect good v1.2.0         # this old version worked
# Git checks out a commit halfway between. Test it, then tell Git:
git bisect good                # or:
git bisect bad
# ...repeat; Git narrows it down in log2(N) steps...
git bisect reset               # finish & return to where you were
```
**Automate it** with a test script (exit 0 = good, non-zero = bad):
```bash
git bisect start HEAD v1.2.0
git bisect run ./run_tests.sh   # Git finds the culprit commit unattended
```
> **Real example:** A test broke somewhere in the last 300 commits. `git bisect run npm test` finds
> the exact breaking commit in ~9 steps instead of you checking hundreds by hand.

---

## 14. Hooks & Automation

Hooks are scripts in `.git/hooks/` that run at certain points. Great for enforcing quality.

| Hook | Fires | Common use |
|---|---|---|
| `pre-commit` | before a commit is created | run linters, formatters, tests, secret scanning |
| `commit-msg` | after the message is written | enforce commit message format (e.g., Conventional Commits) |
| `pre-push` | before pushing | run the test suite, block pushing to `main` |
| `post-merge` | after a merge/pull | auto-run `npm install` if lockfile changed |
| `pre-rebase` | before a rebase | protect published branches |

```bash
# Example .git/hooks/pre-commit (make it executable: chmod +x)
#!/bin/sh
npm run lint || { echo "Lint failed — commit blocked"; exit 1; }
```
> **Team tip:** `.git/hooks` isn't shared by Git. Use a tool like **Husky** (JS), **pre-commit**
> (Python), or `git config core.hooksPath .githooks` to commit shared hooks into the repo.

---

## 15. Large repos: LFS, partial clone, sparse checkout

**Git LFS (Large File Storage)** — store big binaries (videos, models, PSDs) outside the main repo,
keeping a small pointer in Git.
```bash
git lfs install
git lfs track "*.psd"            # writes a rule to .gitattributes
git add .gitattributes
git add design.psd && git commit -m "Add design"
```

**Partial clone** — skip downloading all blobs upfront (huge repos):
```bash
git clone --filter=blob:none <url>      # fetch blobs lazily on demand
git clone --depth=1 <url>               # shallow clone: only the latest commit (CI builds)
```

**Sparse checkout** — only materialize part of a giant monorepo:
```bash
git clone --filter=blob:none --sparse <url>
cd repo
git sparse-checkout set apps/web libs/ui    # only these folders appear on disk
```
> **Real example — monorepo:** A 40 GB monorepo where you only work on one app:
> `--filter=blob:none --sparse` + `sparse-checkout set apps/payments` gives you a fast, tiny working
> directory with only what you need.

---

## 16. Config, Aliases & Quality-of-life

```bash
git config --global user.name  "Saeid"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
git config --global pull.rebase true            # pull = fetch + rebase
git config --global rerere.enabled true         # remember conflict resolutions (see below)
git config --global core.editor "code --wait"

# Handy aliases
git config --global alias.lg "log --oneline --graph --all --decorate"
git config --global alias.st "status -sb"
git config --global alias.last "log -1 HEAD"
git config --global alias.unstage "restore --staged"
git config --global alias.amend "commit --amend --no-edit"
```

**`rerere` (reuse recorded resolution):** once enabled, Git **remembers how you resolved a conflict**
and auto-applies the same resolution next time the same conflict appears — invaluable during long
rebases of long-lived branches.

---

## 17. `.gitignore`, `.gitattributes` & line endings

**`.gitignore`** — patterns for files Git should not track:
```
node_modules/
*.log
.env
dist/
!keep-this.log         # negate: do track this one
```
```bash
git rm -r --cached node_modules   # stop tracking files already committed by mistake
git check-ignore -v somefile      # debug: which rule ignores a file?
```

**`.gitattributes`** — per-path behavior (line endings, diff/merge drivers, LFS, export rules):
```
*.sh   text eol=lf            # force LF line endings for shell scripts
*.png  binary                 # don't try to diff/merge binaries
*.psd  filter=lfs diff=lfs merge=lfs -text
```
> **Line-ending gotcha (Windows/Mac/Linux teams):** set `core.autocrlf` appropriately, or better,
> pin endings in `.gitattributes` so the repo is consistent for everyone.

---

## 18. Team Workflows (Git Flow, Trunk-based, Forking)

### Git Flow
Long-lived `main` (production) + `develop`, plus `feature/*`, `release/*`, `hotfix/*` branches.
- **Pros:** very structured; clear release/hotfix process.
- **Cons:** heavy; lots of branches; slower for continuous delivery.
- **Use when:** scheduled releases, versioned products.

### Trunk-Based Development
Everyone commits small, frequent changes to **one main branch** behind **feature flags**; short-lived
branches merged daily.
- **Pros:** continuous integration/deployment, fewer merge nightmares.
- **Cons:** needs strong CI, tests, and feature-flag discipline.
- **Use when:** fast-moving SaaS teams, CI/CD.

### Forking Workflow
Contributors fork the repo, work on their copy, and open pull requests upstream.
- **Pros:** no write access needed; ideal for open source.
- **Cons:** extra steps to keep forks in sync (see §9).

> **Conventional Commits** (a widely used message standard) make history & automated changelogs
> clean: `feat: add login`, `fix: handle null token`, `docs: update README`, `refactor: ...`,
> `chore: ...`.

---

## 19. GitHub / GitLab: Groups, PRs/MRs & Protected Branches

### Organizations / Groups
- **GitHub Organizations** (and **Teams** within them) / **GitLab Groups** (and **subgroups**) let you
  manage many repos and people together, with shared permissions and visibility.
- **GitLab subgroups** can nest (e.g., `company/backend/payments`), and permissions **inherit**
  downward — a powerful way to model real org structure.
- **Roles/permissions:** typically Read → Triage/Reporter → Write/Developer → Maintain/Maintainer →
  Admin/Owner. Grant the **least privilege** needed.

### Pull Requests (GitHub) / Merge Requests (GitLab)
The review unit: propose merging one branch into another, get review + CI, then merge.
- **Merge strategies:**
  - **Merge commit** — preserves all commits + a merge commit (full history).
  - **Squash and merge** — collapses the PR into one tidy commit on the target (clean history).
  - **Rebase and merge** — replays commits linearly with no merge commit.
- **CODEOWNERS** file auto-requests reviews from the right people for changed paths.
- **Draft PRs/MRs** signal work-in-progress; **required reviews** and **status checks** gate merges.

### Protected Branches
On `main`/`release/*` you typically:
- Require PR review (e.g., 1–2 approvals) and passing CI before merge.
- Forbid force-pushes and direct pushes.
- Require linear history or signed commits if desired.

> **Real example — team setup:** `main` is protected (no direct push, 2 approvals, CI must pass).
> Devs branch `feature/*`, push, open a PR, get review + green CI, then **Squash and merge** for one
> clean commit per feature. A GitLab group `acme/` holds subgroups `acme/web`, `acme/api` with
> inherited Maintainer access for the platform team.

---

## 20. Cleaning, Maintenance & Performance

```bash
git clean -n                    # PREVIEW which untracked files would be deleted
git clean -fd                   # delete untracked files + directories
git gc                          # garbage-collect & compress the repo
git gc --aggressive --prune=now # deeper repack (occasional)
git prune                       # remove unreachable objects
git remote prune origin         # drop local refs to deleted remote branches
git fetch --prune               # fetch + prune stale remote-tracking branches
git repack -ad                  # repack objects into fewer packfiles
git count-objects -vH           # repo size / object stats
git maintenance start           # enable background auto-maintenance (modern Git)
```
> **Shrinking a bloated repo / removing a leaked secret from ALL history:** use
> **`git filter-repo`** (the modern, recommended tool; replaces the old `filter-branch` and BFG):
> ```bash
> git filter-repo --path secrets.env --invert-paths   # scrub a file from entire history
> ```
> Then force-push and have everyone re-clone. (Rotate the leaked secret regardless.)

---

## 21. Advanced / Tricky Commands Cheat Sheet

```bash
# See a file from another branch without switching
git show feature/login:src/app.js

# Restore a single file from another branch
git restore --source=feature/login src/app.js

# Temporarily ignore changes to a tracked file (e.g., local config)
git update-index --skip-worktree config.local.json
git update-index --no-skip-worktree config.local.json   # undo

# Find which commit/tag contains a commit
git branch --contains <sha>
git tag --contains <sha>

# Show what changed between two tags (release notes)
git log --oneline v1.0.0..v1.1.0

# Reapply your branch onto a moved base, keeping merge commits
git rebase --rebase-merges main

# Move the last commit to a different branch you forgot to create
git branch feature-x          # mark current commit
git reset --hard HEAD~1       # remove it from the current branch
git switch feature-x          # it's safe on the new branch

# Combine many commits into one without interactive rebase
git reset --soft <base> && git commit -m "Squashed feature"

# Recover a deleted branch
git reflog && git switch -c restored <sha>

# Sign commits
git commit -S -m "verified"

# Bundle a repo into a single file (offline transfer / backup)
git bundle create repo.bundle --all
```

---

## 22. Interview Questions & Answers

**Q1. Merge vs Rebase — when do you use each?**
Merge preserves true history and creates a merge commit; it's safe for shared branches. Rebase
replays your commits to produce a clean, linear history but **rewrites hashes**, so only use it on
**local/unshared** branches. Typical flow: rebase your feature branch onto `main` to stay current,
then merge (or squash-merge) the PR.

**Q2. `git reset` vs `git revert`?**
`reset` moves the branch pointer and rewrites local history (`--soft` keeps staged, `--mixed` keeps
unstaged, `--hard` discards). `revert` creates a **new** commit that undoes an old one **without
rewriting history** — the safe choice for commits already pushed/shared.

**Q3. How do you recover commits after a bad `git reset --hard`?**
Use `git reflog` to find the commit hash from before the reset, then `git reset --hard <hash>` (or
`git switch -c recovered <hash>`). Reflog tracks every HEAD movement for ~90 days.

**Q4. What actually is a commit?**
A commit is an **object** pointing to a full **tree snapshot** of the project, plus parent commit(s),
author/committer, and a message — identified by the hash of its content. It's a snapshot, not a diff.

**Q5. `git fetch` vs `git pull`?**
`fetch` only downloads remote changes into remote-tracking refs (safe, read-only). `pull` = `fetch` +
`merge` (or `rebase`) into your current branch, modifying your working branch.

**Q6. What is a fast-forward merge?**
When the target branch hasn't diverged, Git just moves its pointer forward to the source branch's tip
— no merge commit. Use `--no-ff` to force a merge commit and keep the feature grouping visible.

**Q7. How do you squash commits / clean up a messy branch?**
`git rebase -i <base>` and mark commits as `squash`/`fixup`, or `git reset --soft <base>` then one
`git commit`. For PRs, "Squash and merge" achieves the same on the platform.

**Q8. How do you safely rewrite and push shared-feature history?**
Rewrite locally (rebase/amend), then **`git push --force-with-lease`**, which refuses to overwrite if
someone else pushed in the meantime — unlike the blunt `--force`.

**Q9. cherry-pick use case?**
Apply a specific commit (e.g., a hotfix that landed on `main`) onto another branch (e.g.,
`release/1.4`) without merging everything: `git cherry-pick <sha>`.

**Q10. Submodule vs subtree?**
Submodule = a pinned pointer to another repo's commit (separate history, fiddly, needs
`--recurse-submodules`). Subtree = the other repo's files merged into yours (simpler for cloners,
bigger repo).

**Q11. How do you find which commit introduced a bug?**
`git bisect` — binary search between a known-good and known-bad commit; automate with
`git bisect run <test-script>`. Or `git log -S "text"` (pickaxe) to find when specific code appeared.

**Q12. What's the staging area / index for?**
It's the **proposed next commit** — it lets you craft a commit precisely (e.g., `git add -p` to stage
only some hunks), separating *what you changed* from *what you're about to record*.

**Q13. How do you work on two branches at once without stashing?**
`git worktree add ../folder <branch>` checks out another branch into a separate directory sharing the
same repo — perfect for a hotfix while a feature is in progress.

**Q14. How do you remove a committed secret from the whole history?**
Use `git filter-repo` to strip the file/string from all commits, force-push, have everyone re-clone —
**and rotate the secret**, since it was already exposed.

---

## 23. Best Practices Checklist

- **Commit small and often**, with clear messages (consider **Conventional Commits**).
- **Branch per feature/fix**; keep branches short-lived.
- **Pull/rebase frequently** to avoid giant, painful merges.
- **Never rewrite public history**; if you must rewrite your own branch, use `--force-with-lease`.
- **Use `git add -p`** to craft clean, logical commits.
- **Protect `main`**: require PR review + green CI, forbid direct pushes/force-pushes.
- **Use `.gitignore`/`.gitattributes`** from day one; never commit secrets or `node_modules`.
- **Tag releases** with annotated tags.
- **Know your escape hatches:** `reflog`, `revert`, `restore`, `stash`, `worktree`, `bisect`.
- **Automate quality** with hooks (Husky/pre-commit) and CI.
- **Rotate any leaked secret**; scrubbing history is not enough on its own.

---

*End of handbook. Master the escape hatches (`reflog`, `revert`, `bisect`, `worktree`) and you'll be
unshakeable in any Git interview or real-world crisis. 🌳*
