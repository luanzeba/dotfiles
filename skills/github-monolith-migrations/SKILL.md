---
name: github-monolith-migrations
description: |
  Guide for creating database migrations in the GitHub monolith (github/github). 
  Use when creating new tables, adding columns, modifying indexes, or working with 
  database schema changes. Covers required configuration files (tableowners.yaml, 
  database_structure.rb, schema-domains.yml), migration-specific rubocop rules, 
  database clusters, and testing patterns.
---

# GitHub Monolith Migrations

## Pre-Flight Checklist

When creating migrations, multiple configuration files may need updating:

| File                               | New Table | Add Column | Purpose                                     |
| ---------------------------------- | --------- | ---------- | ------------------------------------------- |
| `db/migrate/*.rb`                  | Yes       | Yes        | The migration itself                        |
| `db/tableowners.yaml`              | Yes       | No         | Assign table ownership to a team            |
| `lib/github/database_structure.rb` | Yes       | No         | Register table in database cluster constant |
| `db/schema-domains.yml`            | Yes       | No         | Assign table to a schema domain             |
| `sorbet/rbi/dsl/*.rbi`             | Yes       | Yes        | Regenerate with `bin/tapioca dsl`           |

## Generating Migrations

Always use the Rails generator to create migration files:

```bash
# Create a new table
bin/rails g migration CreateCopilotPolicies

# Add column to existing table
bin/rails g migration AddPolicyStudioAssignmentsToCopilotConfigurations
```

This ensures correct timestamp format and file naming conventions.

## Database Clusters

The monolith uses multiple database clusters. Migrations must specify which cluster to use.

**Find the correct cluster** by checking where similar tables are defined:

```bash
# Search for existing table definitions
grep -r "your_related_table" lib/github/database_structure.rb
```

**Common clusters and their constants in `database_structure.rb`:**

- `COPILOT_TABLES` - Copilot-related tables
- `COLLAB_TABLES` - Collaboration features
- `REPOSITORIES_TABLES` - Repository data
- `BILLING_TABLES` - Billing and subscriptions

**Specify the cluster in your migration:**

```ruby
class CreateCopilotPolicies < ActiveRecord::Migration[8.2]
  self.use_connection_class(ApplicationRecord::Copilot)

  def change
    # ...
  end
end
```

## Configuration Files

### 1. Table Owners (`db/tableowners.yaml`)

Assign ownership to a GitHub team:

```bash
# Find insertion point (alphabetical by table name)
grep -n "copilot_" db/tableowners.yaml | head -10
```

Add entry in alphabetical order:

```yaml
copilot_policies: github/copilot-policies
```

### 2. Database Structure (`lib/github/database_structure.rb`)

Register the table in the appropriate cluster constant:

```bash
# Find the cluster constant
grep -n "COPILOT_TABLES" lib/github/database_structure.rb
```

Add table name in alphabetical order within the array:

```ruby
COPILOT_TABLES = %w[
  # ... existing tables ...
  copilot_policies
  # ... more tables ...
]
```

### 3. Schema Domains (`db/schema-domains.yml`)

Assign table to a domain for isolation:

```bash
# Find the domain section
grep -n "^copilot:" db/schema-domains.yml
```

Add table under the appropriate domain in alphabetical order:

```yaml
copilot:
  # ... existing tables ...
  - copilot_policies
  # ... more tables ...
```

## Rubocop Rules

Migration-specific rules to follow:

| Rule                                      | Summary                                                  |
| ----------------------------------------- | -------------------------------------------------------- |
| `OneTablePerMigration`                    | Each migration file touches only one table               |
| `URLColumnsMustBeText`                    | URL columns use `text` type, not `string`                |
| `DoNotAddUniqueIndexToExistingColumn`     | Put unique indexes inside `create_table` block           |
| `DoNotModifyAndDeleteCreateSameMigration` | Don't mix `create_table` with separate `add_index` calls |

See [references/rubocop-rules.md](references/rubocop-rules.md) for detailed explanations and fixes.

**Run rubocop on migrations:**

```bash
bin/rubocop db/migrate/your_migration.rb
```

## Testing Migrations

Always verify migrations are reversible:

```bash
# 1. Run the migration
bin/rails db:migrate

# 2. Test rollback
bin/rails db:rollback STEP=1

# 3. Re-apply to confirm it works both ways
bin/rails db:migrate

# 4. Run rubocop
bin/rubocop db/migrate/your_migration.rb

# 5. Regenerate Sorbet RBI files (if adding columns)
bin/tapioca dsl
```

## Common Patterns

### Create Table with Index

Put indexes inside the `create_table` block:

```ruby
def change
  create_table :copilot_policies, id: :bigint, unsigned: true,
               charset: "utf8mb4", collation: "utf8mb4_unicode_520_ci" do |t|
    t.string :config_name, limit: 255, null: false
    t.string :display_name, limit: 255, null: false
    t.json :policy_config, null: false
    t.text :notes_url, null: true  # URLs must be text type
    t.timestamps

    t.index :config_name, unique: true  # Index inside create_table block
  end
end
```

### Add Column to Existing Table

Use `change_table` with `bulk: true` for efficiency:

```ruby
def change
  change_table :copilot_configurations, bulk: true do |t|
    t.json :policy_assignments, default: nil
  end
end
```

The `bulk: true` option batches ALTER TABLE operations into a single SQL statement, reducing table lock time.

### JSON Columns

For JSON columns, specify `null: false` with a default or allow nulls:

```ruby
t.json :config, null: false                    # Required, no default
t.json :settings, default: nil                 # Optional, defaults to NULL
```
