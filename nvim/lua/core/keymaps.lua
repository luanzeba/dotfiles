-- Keep this file for global/editor-level mappings only.
-- Plugin-specific mappings should live with each plugin config.

-- Follow display lines unless a count explicitly asks for buffer lines.
vim.keymap.set({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
vim.keymap.set({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })

vim.keymap.set("n", "]b", "<cmd>bnext<cr>", { desc = "Buffer: Next" })
vim.keymap.set("n", "[b", "<cmd>bprevious<cr>", { desc = "Buffer: Previous" })
vim.keymap.set("n", "ga", "<cmd>buffer #<cr>", { desc = "Buffer: Alternate" })
