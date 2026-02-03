---
name: github-monolith-developer
description: Ruby on Rails development patterns for the GitHub monolith (github/github). Use when writing code, adding features, creating tests, using feature flags, working with models/controllers/jobs, or following codebase conventions. Covers testing, linting, Sorbet types, and Packwerk packages.
---

# GitHub Monolith Developer

Development patterns for the GitHub monolith Rails application.

## Development Workflow

1. **Before changes**: Run existing tests for the area you're modifying
2. **Make changes**: Small, atomic commits with feature flags for large changes
3. **After changes**: Run tests, linting, type checking

## Running Tests

```bash
# Run specific test file
bin/rails test <path/to/test.rb>

# Run specific test by LINE NUMBER (never use -n flag)
bin/rails test <path/to/test.rb>:42

# Run tests for uncommitted changes
bin/rails test:changes

# Package-specific tests
bin/rails test packages/<name>/test/
```

### Test File Locations

| Source File | Test File |
|------------|-----------|
| `app/models/user.rb` | `test/models/user_test.rb` |
| `app/controllers/repos_controller.rb` | `test/integration/repos_controller_test.rb` |
| `packages/issues/app/models/issue.rb` | `packages/issues/test/models/issue_test.rb` |

### Writing Tests

```ruby
class YourFeatureTest < GitHub::TestCase
  fixtures do
    @user = create(:user)
    @repo = create(:repository, owner: @user)
  end

  setup do
    # Per-test setup
  end

  test "descriptive name" do
    # Arrange, Act, Assert
  end
end
```

**Avoid mocking** - use real objects. Only stub external services.

## Linting and Types

```bash
# Ruby linting (auto-fix)
bin/rubocop --autocorrect <file.rb>

# Sorbet type checking
bin/srb tc <file.rb>

# ERB linting
bin/erb_lint --autocorrect <file.erb>

# Regenerate type definitions
bin/tapioca dsl
```

## Feature Flags

Use for gradual rollout of large changes:

```ruby
if FeatureFlag.vexi.enabled?("package_name:feature_description", actor, default: false)
  # new behavior
else
  # existing behavior
end
```

Test both states:
```ruby
test "with feature enabled" do
  enable_feature_flag(:your_feature, @user)
  # ...
end

test "with feature disabled" do
  disable_feature_flag(:your_feature, @user)
  # ...
end
```

## Common Patterns

### Models with Sorbet

```ruby
# typed: strict
class MyModel < ApplicationRecord
  extend T::Sig

  sig { params(name: String).returns(T::Boolean) }
  def valid_name?(name)
    name.present?
  end
end
```

### Background Jobs

```ruby
class MyJob < ApplicationJob
  queue_as :default

  def perform(user_id)
    user = User.find(user_id)
    # ...
  end
end
```

Test jobs:
```ruby
assert_enqueued_with(job: MyJob, args: [user.id]) do
  # code that enqueues
end

perform_enqueued_jobs do
  # code that triggers jobs
end
```

### Controllers

```ruby
class MyController < ApplicationController
  before_action :authenticate_user!

  def show
    @resource = Resource.find(params[:id])
  end
end
```

## Package Development

When adding to a package in `/packages/<name>/`:

1. Check `package.yml` for allowed dependencies
2. Add code to appropriate `app/` subdirectory
3. Add tests to `test/` subdirectory (mirroring structure)
4. Run `bin/packwerk check` if crossing package boundaries

## Quick Reference

```bash
bin/rails test:changes          # Test uncommitted changes
bin/rubocop -a <file>           # Auto-fix linting
bin/srb tc <file>               # Type check
bin/tapioca dsl                 # Regenerate RBIs
bin/packwerk check              # Check package boundaries
```

