return {
	-- Plenary: Required for many plugins, provides useful Lua functions
	{
		"nvim-lua/plenary.nvim",
		lazy = false, -- Load immediately
	},

	-- Mason: Package manager for LSP servers, DAP servers, linters, and formatters
	{
		"williamboman/mason.nvim",
		cmd = { "Mason", "MasonInstall", "MasonInstallAll", "MasonUpdate" },
		keys = { { "<leader>cm", "<cmd>Mason<cr>", desc = "Mason" } },
		opts = {
			ensure_installed = {
				-- LSP servers
				"lua-language-server",
				"gopls",
				"zls",
				"ruby-lsp",
				"typescript-language-server",
				-- Formatters
				"gofumpt",
				"goimports-reviser",
				"prettier",
				"stylua",
				-- Linters
				"golangci-lint",
				"eslint_d",
			},
			ui = {
				icons = {
					package_pending = " ",
					package_installed = "󰄳 ",
					package_uninstalled = " 󰚌",
				},
				keymaps = {
					toggle_server_expand = "<CR>",
					install_server = "i",
					update_server = "u",
					check_server_version = "c",
					update_all_servers = "U",
					check_outdated_servers = "C",
					uninstall_server = "X",
					cancel_installation = "<C-c>",
				},
			},
			max_concurrent_installers = 10,
		},
		config = function(_, opts)
			require("mason").setup(opts)

			-- Custom command to install all mason binaries listed
			vim.api.nvim_create_user_command("MasonInstallAll", function()
				vim.cmd("MasonInstall " .. table.concat(opts.ensure_installed, " "))
			end, {})

			-- Auto-install packages
			local mr = require("mason-registry")
			mr.refresh(function()
				for _, tool in ipairs(opts.ensure_installed) do
					local p = mr.get_package(tool)
					if not p:is_installed() then
						p:install()
					end
				end
			end)
		end,
	},

	-- LSP Config: Official Neovim LSP client configuration
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
		},
		config = function()
			local lspconfig = require("lspconfig")
			local util = require("util.lsp")

			-- Configure diagnostics
			vim.diagnostic.config({
				underline = true,
				update_in_insert = false,
				virtual_text = {
					spacing = 4,
					source = "if_many",
					prefix = "●",
				},
				severity_sort = true,
				signs = {
					text = {
						[vim.diagnostic.severity.ERROR] = "󰅚",
						[vim.diagnostic.severity.WARN] = "󰀪",
						[vim.diagnostic.severity.HINT] = "󰠠",
						[vim.diagnostic.severity.INFO] = "󰋽",
					},
				},
			})

			-- Setup LSP servers
			local servers = {
				-- Lua
				lua_ls = {
					settings = {
						Lua = {
							workspace = {
								checkThirdParty = false,
							},
							codeLens = {
								enable = true,
							},
							completion = {
								callSnippet = "Replace",
							},
							hint = {
								enable = true,
								setType = false,
								paramType = true,
								paramName = "Disable",
								semicolon = "Disable",
								arrayIndex = "Disable",
							},
						},
					},
				},
				-- Go
				gopls = {
					settings = {
						gopls = {
							analyses = {
								unusedparams = true,
							},
							usePlaceholders = true,
							staticcheck = true,
						},
					},
				},
				-- Zig
				zls = {},
				-- Ruby
				ruby_lsp = {
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
							workspaceSymbol = true,
						},
						featuresConfiguration = {
							inlayHint = {
								implicitHashValue = true,
								implicitRescue = true,
							},
						},
					},
				},
				-- TypeScript/JavaScript
				tsserver = {
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
				},
			}

			-- Setup each server
			for server, config in pairs(servers) do
				lspconfig[server].setup(vim.tbl_deep_extend("force", {
					on_attach = util.on_attach,
					capabilities = util.capabilities,
				}, config))
			end

			-- Format on save for specific filetypes
			local format_augroup = vim.api.nvim_create_augroup("LspFormatting", {})
			local format_filetypes = {
				"go",
				"zig",
				"typescript",
				"javascript",
				"typescriptreact",
				"javascriptreact",
			}

			vim.api.nvim_create_autocmd("BufWritePre", {
				group = format_augroup,
				pattern = format_filetypes,
				callback = function()
					vim.lsp.buf.format()
				end,
			})
		end,
	},

	-- null-ls: Use Neovim as a language server to inject LSP diagnostics, code actions, and more
	{
		"nvimtools/none-ls.nvim",
		event = "BufReadPost",
		config = function()
			local null_ls = require("null-ls")
			local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

			local opts = {
				sources = {
					null_ls.builtins.formatting.gofumpt,
					null_ls.builtins.formatting.goimports_reviser,
				},
				on_attach = function(client, bufnr)
					if client.supports_method("textDocument/formatting") then
						vim.api.nvim_clear_autocmds({
							group = augroup,
							buffer = bufnr,
						})
						vim.api.nvim_create_autocmd("BufWritePre", {
							group = augroup,
							buffer = bufnr,
							callback = function()
								vim.lsp.buf.format({ bufnr = bufnr })
							end,
						})
					end
				end,
			}
			return opts
		end,
	},
}

