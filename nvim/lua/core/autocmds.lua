local group = vim.api.nvim_create_augroup("core-autocmds", { clear = true })

-- Highlight yanked text.
vim.api.nvim_create_autocmd("TextYankPost", {
  group = group,
  callback = function()
    vim.highlight.on_yank()
  end,
})
