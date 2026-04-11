# Merge Conflict Resolution Strategies

## Strategy Selection Guide

### Keep Local (ours)

Choose when:

- The remote change was a refactor that conflicts with your new feature code
- The remote change modified code you intentionally rewrote
- The PR description shows the remote change was a cleanup/style change in an area you substantially changed

### Keep Remote (theirs)

Choose when:

- The remote change was a bug fix and your local code didn't intentionally modify that behavior
- The remote change updated an API/interface and your code should conform to it
- The PR description shows the remote change was a feature that your code should integrate with

### Keep Both / Manual Merge

Choose when:

- Both sides added new code (e.g., new methods, new imports, new config entries)
- The changes are in different logical sections that happen to be adjacent
- Both changes are intentional features that should coexist
- Imports or require statements were added on both sides

## Special File Strategies

### Lock Files (Gemfile.lock, package-lock.json, yarn.lock, pnpm-lock.yaml)

Never manually merge. Accept the version from your branch, then regenerate:

- `Gemfile.lock` → `bundle install`
- `package-lock.json` → `npm install`
- `yarn.lock` → `yarn install`
- `pnpm-lock.yaml` → `pnpm install`

### Schema Files (db/schema.rb, structure.sql)

Accept the remote version, then re-run your local migrations:

- `db/schema.rb` → `bin/rails db:migrate`

### Auto-generated Files (GraphQL schemas, Sorbet RBI, compiled assets)

Accept either version, then regenerate using the project's build tooling.

### CHANGELOG / Release Notes

Almost always keep both entries — they represent different changes. Place them in chronological order.

### CODEOWNERS / SERVICEOWNERS

Usually keep both additions. Verify no duplicate/conflicting ownership rules.

## Conflict Marker Anatomy

```
<<<<<<< HEAD (or branch name)
[LOCAL CHANGES - your branch's version]
=======
[REMOTE CHANGES - the incoming branch's version]
>>>>>>> main (or commit SHA)
```

- Everything between `<<<<<<< HEAD` and `=======` is YOUR local change
- Everything between `=======` and `>>>>>>>` is the REMOTE/incoming change
