local function workspace_root()
  return vim.fs.root(0, { ".git", ".jj" }) or vim.fn.getcwd()
end

return {
  {
    "ibhagwan/fzf-lua",
    cmd = "FzfLua",
    opts = { "max-perf" },
    keys = {
      {
        "<leader>f",
        function()
          require("fzf-lua").files({ cwd = workspace_root() })
        end,
        desc = "Files (workspace)",
      },
      {
        "<leader>F",
        function()
          require("fzf-lua").files({ cwd = vim.fn.getcwd() })
        end,
        desc = "Files (cwd)",
      },
      {
        "<leader>b",
        function()
          require("fzf-lua").buffers()
        end,
        desc = "Buffers",
      },
      {
        "<leader>/",
        function()
          require("fzf-lua").live_grep({ cwd = workspace_root() })
        end,
        desc = "Search in workspace (rg)",
      },
      {
        "<leader>'",
        function()
          require("fzf-lua").resume()
        end,
        desc = "Resume picker",
      },
    },
  },
}
