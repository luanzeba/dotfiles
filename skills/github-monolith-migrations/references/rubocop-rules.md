# Migration Rubocop Rules

Detailed explanations of GitHub monolith migration-specific rubocop rules.

## GitHub/OneTablePerMigration

**What it checks:** Each migration file should only create, modify, or drop one table.

**Triggers when:** A migration contains operations on multiple tables (e.g., `create_table` for one table and `change_table` for another).

**Fix:** Split into separate migration files with sequential timestamps.

```bash
# Generate two separate migrations
bin/rails g migration CreateCopilotPolicies
bin/rails g migration AddPolicyAssignmentsToCopilotConfigurations
```

## GitHub/URLColumnsMustBeText

**What it checks:** Columns containing URLs must use the `text` type, not `string`/`varchar`.

**Triggers when:** A column name contains `url` (case-insensitive) and uses `string` type.

**Fix:** Change `t.string` to `t.text` and remove the `limit` option:

```ruby
# Bad
t.string :github_issue_url, limit: 255, null: true

# Good
t.text :github_issue_url, null: true
```

## GitHub/DoNotAddUniqueIndexToExistingColumn

**What it checks:** Unique indexes should not be added via separate `add_index` calls.

**Triggers when:** Using `add_index :table, :column, unique: true` outside of `create_table`.

**Fix:** Move the index inside the `create_table` block:

```ruby
# Bad
create_table :policies do |t|
  t.string :name
end
add_index :policies, :name, unique: true

# Good
create_table :policies do |t|
  t.string :name
  t.index :name, unique: true
end
```

## GitHub/DoNotModifyAndDeleteCreateSameMigration

**What it checks:** Table modifications (like `add_index`) should not appear in the same migration that creates or drops the table.

**Triggers when:** A migration has both `create_table` and a separate schema modification like `add_index` on the same table.

**Fix:** Include all indexes and constraints inside the `create_table` block:

```ruby
# Bad
def change
  create_table :policies do |t|
    t.string :name
    t.timestamps
  end
  add_index :policies, :name, unique: true
  add_index :policies, :created_at
end

# Good
def change
  create_table :policies do |t|
    t.string :name
    t.timestamps

    t.index :name, unique: true
    t.index :created_at
  end
end
```

## Running Rubocop

Check migrations before committing:

```bash
# Single file
bin/rubocop db/migrate/20260203224926_create_copilot_policies.rb

# All migrations (slow)
bin/rubocop db/migrate/

# Auto-fix safe issues
bin/rubocop -a db/migrate/your_migration.rb
```
