-- Keep this file for global/editor-level mappings only.
-- Plugin-specific mappings should live with each plugin config.

vim.keymap.set("n", "]b", "<cmd>bnext<cr>", { desc = "Buffer: Next" })
vim.keymap.set("n", "[b", "<cmd>bprevious<cr>", { desc = "Buffer: Previous" })
vim.keymap.set("n", "ga", "<cmd>buffer #<cr>", { desc = "Buffer: Alternate" })
