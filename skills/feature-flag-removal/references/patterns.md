# Feature Flag Removal Patterns

Concrete before/after examples for every transformation type. Each section shows
the code pattern, the reasoning, and the result after flag removal.

All examples assume the flag was **successful** — the enabled path is kept.

## Table of contents

- [T1: Simple if/else](#t1-simple-ifelse)
- [T2: Simple if (no else)](#t2-simple-if-no-else)
- [T3: Guard clause — return unless](#t3-guard-clause--return-unless)
- [T4: Guard clause — return if / next if](#t4-guard-clause--return-if--next-if)
- [T5: Unless block](#t5-unless-block)
- [T6: Ternary](#t6-ternary)
- [T7: Compound condition](#t7-compound-condition)
- [T8: Negated flag check](#t8-negated-flag-check)
- [T9: ERB conditionals](#t9-erb-conditionals)
- [T10: Test helper calls](#t10-test-helper-calls)
- [T11: Flag definitions](#t11-flag-definitions)
- [T12: Memoized predicates](#t12-memoized-predicates)
- [T13: Flag used as data](#t13-flag-used-as-data--do-not-auto-transform)
- [Indentation rules](#indentation-rules)

---

## T1: Simple if/else

The most common pattern. The `if` branch ran when the flag was on; the `else`
branch was the old behavior.

### Controller example

```ruby
# Before
def show
  if current_user.feature_flag_enabled?(:new_dashboard_layout, default: false)
    @dashboard = NewDashboard.new(current_user)
    render :show_v2
  else
    @dashboard = Dashboard.new(current_user)
    render :show
  end
end

# After
def show
  @dashboard = NewDashboard.new(current_user)
  render :show_v2
end
```

### Model example

```ruby
# Before
def notification_preference
  if feature_flag_enabled?(:notification_preference_v2, default: false)
    computed_preference
  else
    "email"
  end
end

# After
def notification_preference
  computed_preference
end
```

### With unscoped flag

```ruby
# Before
if FeatureFlag.vexi.enabled?(:post_receive_commit_co_authors, commit.repository, default: false)
  commit.author_names.drop(1).zip(commit.author_emails.drop(1)).filter_map do |name, email|
    next if name.blank? || email.blank?
    { email: email, name: name }
  end
else
  []
end

# After
commit.author_names.drop(1).zip(commit.author_emails.drop(1)).filter_map do |name, email|
  next if name.blank? || email.blank?
  { email: email, name: name }
end
```

---

## T2: Simple if (no else)

The flag-gated code is purely additive — there was no old behavior to fall back to.

```ruby
# Before
if user.feature_flag_enabled?(:send_welcome_v2, default: false)
  WelcomeMailer.send_v2(user)
end

# After
WelcomeMailer.send_v2(user)
```

### Multi-line block

```ruby
# Before
if repo.feature_flag_enabled?(:enhanced_security_scan, default: false)
  scanner = SecurityScanner.new(repo)
  scanner.run_enhanced_checks
  scanner.report_findings
end

# After
scanner = SecurityScanner.new(repo)
scanner.run_enhanced_checks
scanner.report_findings
```

---

## T3: Guard clause — return unless

The guard ensures the flag is enabled before proceeding. Since the flag is now
always on, the guard always passes and is dead code.

```ruby
# Before
def delete_user(user)
  return unless user.feature_flag_enabled?(:windbeam_integration, default: false)
  return if user.bot?
  WindbeamClient.delete(user)
end

# After
def delete_user(user)
  return if user.bot?
  WindbeamClient.delete(user)
end
```

### Early return with value

```ruby
# Before
def premium_features
  return [] unless current_user.feature_flag_enabled?(:premium_v2, default: false)
  PremiumFeature.for_user(current_user)
end

# After
def premium_features
  PremiumFeature.for_user(current_user)
end
```

---

## T4: Guard clause — return if / next if

The flag being always-on means this guard always fires. The return/next becomes
unconditional.

```ruby
# Before
def legacy_sync
  return if user.feature_flag_enabled?(:skip_legacy_sync, default: false)
  LegacySystem.sync(user)
end

# After — the return is now unconditional; the code below is unreachable
def legacy_sync
  return
  LegacySystem.sync(user)  # ← unreachable — flag for user review
end
```

**Important**: When `return if flag_enabled?` makes subsequent code unreachable,
flag the entire method for user review. The user likely wants to delete the
method entirely or restructure the caller.

### next if inside a loop

```ruby
# Before
items.each do |item|
  next if item.feature_flag_enabled?(:skip_deprecated_items, default: false)
  process(item)
end

# After — next is always hit; loop body never runs. Flag for review.
items.each do |item|
  next
  process(item)  # unreachable
end
```

---

## T5: Unless block

`unless flag_enabled?` means "when the flag is OFF". The flag is now always on,
so this block never executes.

### With else

```ruby
# Before
unless current_user.feature_flag_enabled?(:respect_time_pref, default: false)
  render_relative_time(timestamp)
else
  render_absolute_time(timestamp)
end

# After — keep the else body (enabled path)
render_absolute_time(timestamp)
```

### Without else

```ruby
# Before
unless org.feature_flag_enabled?(:disable_legacy_audit, default: false)
  LegacyAuditLog.record(org, action)
end

# After — delete the entire block (it ran only when the flag was off)
```

---

## T6: Ternary

```ruby
# Before
label = user.feature_flag_enabled?(:new_labels, default: false) ? "Updated" : "Legacy"

# After
label = "Updated"
```

### Assignment with ternary

```ruby
# Before
co_authors = if FeatureFlag.vexi.enabled?(:co_author_parsing, repo, default: false)
  parse_co_authors(commit)
else
  []
end

# After
co_authors = parse_co_authors(commit)
```

---

## T7: Compound condition

### Flag && other_condition

`true && X` simplifies to `X`.

```ruby
# Before
if user.feature_flag_enabled?(:copilot_ci_bypass, default: false) && user.has_cfi_access?
  grant_ci_access(user)
end

# After
if user.has_cfi_access?
  grant_ci_access(user)
end
```

### Flag || other_condition

`true || X` is always true — remove the entire conditional.

```ruby
# Before
if user.feature_flag_enabled?(:new_availability_check, default: false) || legacy_available?(user)
  data[:available] = true
end

# After
data[:available] = true
```

### Flag as one of several conditions

```ruby
# Before
if admin? && org.feature_flag_enabled?(:new_perms, default: false) && org.plan.supports_feature?
  show_advanced_settings
end

# After — remove the flag check, keep the rest
if admin? && org.plan.supports_feature?
  show_advanced_settings
end
```

### Negated compound

```ruby
# Before
if !user.feature_flag_enabled?(:skip_validation, default: false) || force_validate
  run_validation
end

# After — !true || force_validate simplifies to force_validate
if force_validate
  run_validation
end
```

---

## T8: Negated flag check

```ruby
# Before
if !actor.feature_flag_enabled?(:my_flag, default: false)
  old_behavior
end

# After — !true is false; block never executes. Delete entirely.
```

```ruby
# Before
do_something unless actor.feature_flag_enabled?(:my_flag, default: false)

# After — the unless is always true (flag is on), so the line never runs. Delete.
```

---

## T9: ERB conditionals

### if/else in ERB

```erb
<%# Before %>
<% if current_user.feature_flag_enabled?(:new_nav, default: false) %>
  <%= render "shared/new_navigation" %>
<% else %>
  <%= render "shared/navigation" %>
<% end %>

<%# After %>
<%= render "shared/new_navigation" %>
```

### if-only in ERB

```erb
<%# Before %>
<% if FeatureFlag.vexi.enabled?(:show_banner, current_user, default: false) %>
  <div class="banner">New feature available!</div>
<% end %>

<%# After %>
<div class="banner">New feature available!</div>
```

### unless in ERB

```erb
<%# Before %>
<% unless current_user.feature_flag_enabled?(:hide_legacy_widget, default: false) %>
  <%= render "legacy_widget" %>
<% end %>

<%# After — delete entirely (block only ran when flag was off) %>
```

---

## T10: Test helper calls

### enable_feature_flag — delete the line

```ruby
# Before
setup do
  @user = create(:user)
  enable_feature_flag(:my_flag, @user)
  @repo = create(:repository, owner: @user)
end

# After
setup do
  @user = create(:user)
  @repo = create(:repository, owner: @user)
end
```

### disable_feature_flag — delete the line, flag test for review

```ruby
# Before
test "shows legacy UI when flag is disabled" do
  disable_feature_flag(:my_flag, @user)
  get dashboard_path
  assert_select ".legacy-dashboard"
end

# After — FLAG FOR USER REVIEW: this test was testing the disabled path
# which no longer exists. The entire test may need deletion.
```

### Global enable in fixtures block

```ruby
# Before
fixtures do
  @user = create(:user)
  enable_feature_flag(:my_flag)
end

# After
fixtures do
  @user = create(:user)
end
```

---

## T11: Flag definitions

### Seed file entry

```ruby
# Before (in script/seeds/objects/feature_flag.rb or similar)
FeatureFlag.vexi_management.enable_feature_flag(:my_flag)

# After — delete the line
```

### Config/YAML entry

```yaml
# Before
feature_flags:
  my_flag:
    description: "Enable new dashboard layout"
    default: false

# After — delete the entry
```

---

## T12: Memoized predicates

### Simple memoized check

```ruby
# Before
def my_flag_enabled?
  return @my_flag_enabled if defined?(@my_flag_enabled)
  @my_flag_enabled = feature_flag_enabled?(:my_flag, default: false)
end

# After
def my_flag_enabled?
  true
end
```

**Note**: If this method has many callers, consider inlining `true` at each call
site and deleting the method entirely. List the call sites for user review.

### Used in conditional

```ruby
# Before
def show
  if my_flag_enabled?
    render :new_show
  else
    render :show
  end
end

# After — if the predicate now returns true, this becomes:
def show
  render :new_show
end
```

---

## T13: Flag used as data — DO NOT AUTO-TRANSFORM

These require user judgment. Present them with context and ask.

### Hash snapshot

```ruby
ff_snapshot: {
  my_flag: actor.feature_flag_enabled?(:my_flag, default: false),
  other_flag: actor.feature_flag_enabled?(:other_flag, default: false),
}
```

Ask the user: "This flag is used as data in a hash snapshot. Should I replace
the value with `true`, remove the key entirely, or leave it as-is?"

### Dynamic flag iteration

```ruby
all_models.filter { |m| m.feature_flag.present? }
  .map { |m| [m.feature_flag, user.feature_flag_enabled?(m.feature_flag.to_sym, default: false)] }
  .to_h
```

This iterates over model-defined flags dynamically. The flag name is stored in
the model data, not hardcoded. Flag for manual review — the user may need to
update the model data rather than (or in addition to) the code.

---

## Indentation rules

When unwrapping a conditional (removing `if`/`else`/`end` wrapper):

1. Identify the indentation of the `if` line (e.g., 4 spaces).
2. The body inside the `if` is typically indented one level deeper (e.g., 6 spaces).
3. After removing the wrapper, dedent the body by one level (6 → 4 spaces) so it
   aligns with where the `if` was.

```ruby
# Before (controller method)
    def show
      if current_user.feature_flag_enabled?(:new_show, default: false)
        @item = Item.find(params[:id])
        render :show_v2
      else
        @item = Item.find_legacy(params[:id])
        render :show
      end
    end

# After — body dedented to match the method level
    def show
      @item = Item.find(params[:id])
      render :show_v2
    end
```
