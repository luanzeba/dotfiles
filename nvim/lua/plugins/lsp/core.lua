return {
  {
    "williamboman/mason.nvim",
    cmd = { "Mason", "MasonInstall", "MasonUninstall", "MasonUpdate" },
    opts = {},
  },

  {
    "williamboman/mason-lspconfig.nvim",
    dependencies = { "williamboman/mason.nvim" },
    opts = {
      ensure_installed = {},
      automatic_installation = true,
    },
  },

  {
    "neovim/nvim-lspconfig",
    event = { "BufReadPre", "BufNewFile" },
    dependencies = { "williamboman/mason-lspconfig.nvim" },
    opts = {
      servers = {},
    },
    config = function(_, opts)
      vim.diagnostic.config({
        update_in_insert = false,
        severity_sort = true,
      })

      local capabilities = vim.lsp.protocol.make_client_capabilities()

      -- Keep LSP keymaps minimal and close to common Helix motions where possible.
      local lsp_group = vim.api.nvim_create_augroup("minimal-lsp-keymaps", { clear = true })
      vim.api.nvim_create_autocmd("LspAttach", {
        group = lsp_group,
        callback = function(event)
          local map = function(lhs, rhs, desc, mode)
            vim.keymap.set(mode or "n", lhs, rhs, { buffer = event.buf, desc = desc })
          end

          map("gd", vim.lsp.buf.definition, "LSP: Definition")
          map("gr", vim.lsp.buf.references, "LSP: References")
          map("K", vim.lsp.buf.hover, "LSP: Hover")
          map("<leader>a", vim.lsp.buf.code_action, "LSP: Code action", { "n", "v" })
          map("<leader>r", vim.lsp.buf.rename, "LSP: Rename")
        end,
      })

      vim.keymap.set("n", "[d", function()
        vim.diagnostic.jump({ count = -1, float = true })
      end, { desc = "Diagnostic: Previous" })

      vim.keymap.set("n", "]d", function()
        vim.diagnostic.jump({ count = 1, float = true })
      end, { desc = "Diagnostic: Next" })

      vim.keymap.set("n", "<leader>d", vim.diagnostic.open_float, { desc = "Diagnostic: Line details" })

      local has_new_lsp_api = type(vim.lsp.config) == "table" and type(vim.lsp.enable) == "function"
      local lspconfig = has_new_lsp_api and nil or require("lspconfig")

      for server, server_opts in pairs(opts.servers) do
        local merged_opts = vim.tbl_deep_extend("force", {
          capabilities = capabilities,
        }, server_opts or {})

        if has_new_lsp_api then
          vim.lsp.config(server, merged_opts)
          vim.lsp.enable(server)
        else
          lspconfig[server].setup(merged_opts)
        end
      end
    end,
  },
}
