---@class cmp.util
local M = {}

---@alias cmp.lsp.CompletionItemKind
---| 1 # Text
---| 2 # Method
---| 3 # Function
---| 4 # Constructor
---| 5 # Field
---| 6 # Variable
---| 7 # Class
---| 8 # Interface
---| 9 # Module
---| 10 # Property
---| 11 # Unit
---| 12 # Value
---| 13 # Enum
---| 14 # Keyword
---| 15 # Snippet
---| 16 # Color
---| 17 # File
---| 18 # Reference
---| 19 # Folder
---| 20 # EnumMember
---| 21 # Constant
---| 22 # Struct
---| 23 # Event
---| 24 # Operator
---| 25 # TypeParameter

---@alias cmp.lsp.MarkupKind
---| '"plaintext"'
---| '"markdown"'

---@class cmp.Entry
---@field get_completion_item fun(): cmp.CompletionItem
---@field get_kind fun(): cmp.lsp.CompletionItemKind

---@class cmp.CompletionItem
---@field kind cmp.lsp.CompletionItemKind
---@field documentation? {kind: cmp.lsp.MarkupKind, value: string}
---@field insertText? string

---@class cmp.CustomEntriesView
---@field get_entries fun(): cmp.Entry[]

---@class cmp.NativeEntriesView
---@field get_entries fun(): cmp.Entry[]

---@class cmp.ConfigSchema
---@field sources cmp.Source[]
---@field auto_brackets? string[]

---@class cmp.Source
---@field group_index? number

---@alias cmp.ConfirmBehavior
---| '"insert"'
---| '"replace"'

---@class cmp.SnippetNode
---@field type "snippet"
---@field value string

---@alias cmp.util.Action fun():boolean?
---@type table<string, cmp.util.Action>
M.actions = {
  -- Native Snippets
  snippet_forward = function()
    if vim.snippet.active({ direction = 1 }) then
      vim.schedule(function()
        vim.snippet.jump(1)
      end)
      return true
    end
  end,
  snippet_stop = function()
    if vim.snippet then
      vim.snippet.stop()
    end
  end,
}

---@param actions string[]
---@param fallback? string|fun()
function M.map(actions, fallback)
  return function()
    for _, name in ipairs(actions) do
      if M.actions[name] then
        local ret = M.actions[name]()
        if ret then
          return true
        end
      end
    end
    return type(fallback) == "function" and fallback() or fallback
  end
end

---@alias Placeholder {n:number, text:string}

---@param snippet string
---@param fn fun(placeholder:Placeholder):string
---@return string
function M.snippet_replace(snippet, fn)
  return snippet:gsub("%$%b{}", function(m)
    local n, name = m:match("^%${(%d+):(.+)}$")
    return n and fn({ n = n, text = name }) or m
  end) or snippet
end

-- This function resolves nested placeholders in a snippet.
---@param snippet string
---@return string
function M.snippet_preview(snippet)
  local ok, parsed = pcall(function()
    return vim.lsp._snippet_grammar.parse(snippet)
  end)
  return ok and tostring(parsed)
      or M.snippet_replace(snippet, function(placeholder)
        return M.snippet_preview(placeholder.text)
      end):gsub("%$0", "")
end

-- This function replaces nested placeholders in a snippet with LSP placeholders.
function M.snippet_fix(snippet)
  local texts = {} ---@type table<number, string>
  return M.snippet_replace(snippet, function(placeholder)
    texts[placeholder.n] = texts[placeholder.n] or M.snippet_preview(placeholder.text)
    return "${" .. placeholder.n .. ":" .. texts[placeholder.n] .. "}"
  end)
end

---@param entry cmp.Entry
function M.auto_brackets(entry)
  local cmp = require("cmp")
  local Kind = cmp.lsp.CompletionItemKind
  local item = entry:get_completion_item()
  if vim.tbl_contains({ Kind.Function, Kind.Method }, item.kind) then
    local cursor = vim.api.nvim_win_get_cursor(0)
    local prev_char = vim.api.nvim_buf_get_text(0, cursor[1] - 1, cursor[2], cursor[1] - 1, cursor[2] + 1, {})[1]
    if prev_char ~= "(" and prev_char ~= ")" then
      local keys = vim.api.nvim_replace_termcodes("()<left>", false, false, true)
      vim.api.nvim_feedkeys(keys, "i", true)
    end
  end
end

-- This function adds missing documentation to snippets.
-- The documentation is a preview of the snippet.
---@param window cmp.CustomEntriesView|cmp.NativeEntriesView
function M.add_missing_snippet_docs(window)
  local cmp = require("cmp")
  local Kind = cmp.lsp.CompletionItemKind
  local entries = window:get_entries()
  for _, entry in ipairs(entries) do
    if entry:get_kind() == Kind.Snippet then
      local item = entry:get_completion_item()
      if not item.documentation and item.insertText then
        item.documentation = {
          kind = cmp.lsp.MarkupKind.Markdown,
          value = string.format("```%s\n%s\n```", vim.bo.filetype, M.snippet_preview(item.insertText)),
        }
      end
    end
  end
end

-- This is a better implementation of `cmp.confirm`:
--  * check if the completion menu is visible without waiting for running sources
--  * create an undo point before confirming
-- This function is both faster and more reliable.
---@param opts? {select: boolean, behavior: cmp.ConfirmBehavior}
function M.confirm(opts)
  local cmp = require("cmp")
  opts = vim.tbl_extend("force", {
    select = true,
    behavior = cmp.ConfirmBehavior.Insert,
  }, opts or {})
  return function(fallback)
    if cmp.core.view:visible() or vim.fn.pumvisible() == 1 then
      -- Create an undo point
      vim.cmd("undojoin")
      if cmp.confirm(opts) then
        return
      end
    end
    return fallback()
  end
end

---@param opts cmp.ConfigSchema | {auto_brackets?: string[]}
function M.setup(opts)
  for _, source in ipairs(opts.sources) do
    source.group_index = source.group_index or 1
  end

  local parse = require("cmp.utils.snippet").parse
  require("cmp.utils.snippet").parse = function(input)
    local ok, ret = pcall(parse, input)
    if ok then
      return ret
    end
    -- Return nil on parse failure
    return nil
  end

  local cmp = require("cmp")
  cmp.setup(opts)
  cmp.event:on("confirm_done", function(event)
    if vim.tbl_contains(opts.auto_brackets or {}, vim.bo.filetype) then
      M.auto_brackets(event.entry)
    end
  end)
  cmp.event:on("menu_opened", function(event)
    M.add_missing_snippet_docs(event.window)
  end)
end

return M

