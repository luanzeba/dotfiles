# Response Examples

This document provides concrete examples of well-structured responses to code review comments.

## Example 1: Responding to "Should this behavior be different?"

A reviewer asks: "This constant is used everywhere, but if we want to change the value dynamically, won't we need to update all these call sites? Should we make this dynamic?"

**Research process:** First, understand how constants work in the language. In Ruby, constants are evaluated once at assignment time. Check the official documentation to confirm this. The Rails autoloading guide has a section called "Reloading and Stale Objects" that explicitly states: "Ruby does not have a way to truly reload classes and modules in memory."

**Response:**

> Good catch. Ruby constants are evaluated once at assignment time, so assigning `SOME_CONSTANT = DynamicSource.value` would evaluate when the class loads and never update afterward. The Rails autoloading guide notes this in the ["Reloading and Stale Objects"](https://guides.rubyonrails.org/autoloading_and_reloading_constants.html#reloading-and-stale-objects) section.
>
> I've replaced the constant references with direct method calls in commit abc123def. The two usages in [`config_source.rb`](https://github.com/org/repo/blob/abc123def/app/models/config_source.rb#L36-L40) are intentionally kept as fallback values.
>
> Worth noting that the critical code paths were already using the dynamic method, so the system would self-heal even if some references were missed.

**Why this works:** The response acknowledges the valid concern, explains the technical limitation with a documentation link, references the commit that addresses it, and explains why the system is robust.

## Example 2: Responding to "How does this data persist?"

A reviewer asks: "What's the retention policy on this key-value store? Will these values expire?"

**Research process:** Trace the data flow to find the backing store. Look at the KV class implementation to see what database or service it uses. Check the `set()` call to see if a TTL is specified. Review the gem or library documentation for default behavior.

**Response:**

> The KV store is backed by MySQL via the [`some-kv`](https://github.com/org/some-kv) gem, which stores data in the `key_values` table with no automatic expiration.
>
> You can see the backing store in [`KV::DataStore`](https://github.com/org/repo/blob/abc123def/app/models/kv/data_store.rb), and the `set()` call at [`config_manager.rb:78`](https://github.com/org/repo/blob/abc123def/app/models/config_manager.rb#L78) does not specify a TTL, so values persist indefinitely until explicitly overwritten.

**Why this works:** The response directly answers the question with specific evidence. It links to the backing implementation, the specific line where values are written, and explains the retention behavior.

## Example 3: Writing a Review Comment About a Potential Issue

You notice that a new feature writes to the database inside a loop, and the request can contain hundreds of records.

**Comment:**

> `save_record()` runs once per item here, so a request with 500 items makes 500 separate database writes. This can become a performance issue as the request grows.
>
> Could we collect the rows and insert them in one call? We don't use callbacks from `save_record()` in this path, so `insert_all` should preserve the behavior while avoiding the repeated writes.
>
> ```ruby
> rows = items.map { |item| attributes_for(item) }
> Record.insert_all(rows)
> ```

**Why this works:** The comment explains the repeated writes, recommends one fix, and shows what the code could look like.
