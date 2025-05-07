dofile(vim.g.base46_cache .. "lsp")
require "nvchad.lsp"

local M = {}
local utils = require "core.utils"

-- export on_attach & capabilities for custom lspconfigs

M.on_attach = function(client, bufnr)
  utils.load_mappings("lspconfig", { buffer = bufnr })

  if client.server_capabilities.signatureHelpProvider then
    require("nvchad.signature").setup(client)
  end

  if not utils.load_config().ui.lsp_semantic_tokens and client.supports_method "textDocument/semanticTokens" then
    client.server_capabilities.semanticTokensProvider = nil
  end
end

M.capabilities = vim.lsp.protocol.make_client_capabilities()

M.capabilities.textDocument.completion.completionItem = {
  documentationFormat = { "markdown", "plaintext" },
  snippetSupport = false,
  preselectSupport = true,
  insertReplaceSupport = true,
  labelDetailsSupport = true,
  deprecatedSupport = true,
  commitCharactersSupport = true,
  tagSupport = { valueSet = { 1 } },
  resolveSupport = {
    properties = {
      "documentation",
      "detail",
      "additionalTextEdits",
    },
  },
}

local lspconfig = require("lspconfig")

-- Lua LSP
lspconfig.lua_ls.setup {
  on_attach = M.on_attach,
  capabilities = M.capabilities,

  settings = {
    Lua = {
      diagnostics = {
        globals = { "vim" },
      },
      workspace = {
        library = {
          [vim.fn.expand "$VIMRUNTIME/lua"] = true,
          [vim.fn.expand "$VIMRUNTIME/lua/vim/lsp"] = true,
          [vim.fn.stdpath "data" .. "/lazy/ui/nvchad_types"] = true,
          [vim.fn.stdpath "data" .. "/lazy/lazy.nvim/lua/lazy"] = true,
        },
        maxPreload = 100000,
        preloadFileSize = 10000,
      },
    },
  },
}

-- Go LSP
lspconfig.gopls.setup {
  on_attach = M.on_attach,
  capabilities = M.capabilities,
  settings = {
    gopls = {
      analyses = {
        unusedparams = true,
      },
      usePlaceholders = true,
      staticcheck = true,
    },
  },
}

-- Zig LSP
vim.api.nvim_create_autocmd('BufWritePre',{
  pattern = {"*.zig", "*.zon"},
  callback = function(ev)
    vim.lsp.buf.format()
  end
})

lspconfig.zls.setup {
  on_attach = M.on_attach,
  capabilities = M.capabilities,
}

-- Ruby LSP
lspconfig.ruby_lsp.setup({
	on_attach = M.on_attach,
	capabilities = M.capabilities,
	init_options = {
		formatter = "rubocop",
		linters = { "rubocop" },
		enabledFeatures = {
			codeActions = true,
			codeLens = true,
			completion = true,
			definition = true,
			diagnostics = true,
			documentHighlights = true,
			documentLink = true,
			documentSymbols = true,
			foldingRanges = true,
			formatting = true,
			hover = true,
			inlayHint = true,
			onTypeFormatting = true,
			selectionRanges = true,
			semanticHighlighting = true,
			signatureHelp = true,
			typeHierarchy = true,
			workspaceSymbol = true
		},
		featuresConfiguration = {
			inlayHint = {
				implicitHashValue = true,
				implicitRescue = true
			}
		},
	},
})

-- TypeScript/JavaScript LSP
vim.api.nvim_create_autocmd('BufWritePre', {
  pattern = {"*.tsx", "*.ts", "*.jsx", "*.js"},
  callback = function(ev)
    vim.lsp.buf.format()
  end
})

lspconfig.tsserver.setup {
  on_attach = M.on_attach,
  capabilities = M.capabilities,
  filetypes = { "typescript", "javascript", "typescriptreact", "javascriptreact" },
  settings = {
    typescript = {
      inlayHints = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
    },
    javascript = {
      inlayHints = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
    },
  },
}

return M
