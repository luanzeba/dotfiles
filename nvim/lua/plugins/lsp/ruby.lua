return {
  {
    "williamboman/mason-lspconfig.nvim",
    opts = function(_, opts)
      opts.ensure_installed = opts.ensure_installed or {}
      if not vim.tbl_contains(opts.ensure_installed, "ruby_lsp") then
        table.insert(opts.ensure_installed, "ruby_lsp")
      end
    end,
  },

  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        ruby_lsp = {
          -- Intentionally minimal: use ruby-lsp as installed by Mason.
          -- If private gem source issues return, we can restore isolated bundle setup.
          init_options = {
            formatter = "auto",
          },
        },
        sorbet = {
          -- Ruby LSP intentionally defers some typed Ruby navigation to Sorbet.
          -- Devcontainers usually don't run watchman, so disable it for LSP mode.
          cmd = { "bin/srb", "tc", "--lsp", "--disable-watchman" },
        },
      },
    },
  },
}
