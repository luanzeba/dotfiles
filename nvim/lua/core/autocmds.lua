local group = vim.api.nvim_create_augroup("core-autocmds", { clear = true })

-- Highlight yanked text.
vim.api.nvim_create_autocmd("TextYankPost", {
  group = group,
  callback = function()
    vim.highlight.on_yank()
  end,
})

-- We use LSP for symbol navigation; disable Ruby ftplugin tag mappings (ctags-style).
vim.api.nvim_create_autocmd("FileType", {
  group = group,
  pattern = "ruby",
  callback = function(args)
    local keys = {
      "<C-]>",
      "g<C-]>",
      "g]",
      "<C-W>]",
      "<C-W><C-]>",
      "<C-W>g<C-]>",
      "<C-W>g]",
      "<C-W>}",
      "<C-W>g}",
    }

    for _, lhs in ipairs(keys) do
      pcall(vim.keymap.del, "n", lhs, { buffer = args.buf })
    end
  end,
})
