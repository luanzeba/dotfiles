-- Helper module for formatting only changed/edited lines
local M = {}

-- Format only changed lines
M.format_edited_lines = function()
  -- Format only the changed range
  vim.lsp.buf.format({
    range = {
      start = vim.api.nvim_buf_get_mark(0, '['),
      ["end"] = vim.api.nvim_buf_get_mark(0, ']')
    }
  })
end

return M