---@class TSConfig
---@field highlight table
---@field indent table
---@field ensure_installed string[]
---@field incremental_selection table
---@field textobjects table

return {
	-- Which-key is a plugin that shows a popup with all
	-- the keymaps that are available in the current context
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {
			plugins = { spelling = true },
		},
	},

	-- Treesitter is a parser generator tool that we can
	-- use in Neovim to power faster and more accurate
	-- syntax highlighting.
	{
		"nvim-treesitter/nvim-treesitter",
		version = false, -- last release is way too old and doesn't work on Windows
		build = ":TSUpdate",
		event = { "BufReadPost", "BufNewFile" },
		init = function(plugin)
			-- PERF: add nvim-treesitter queries to the rtp and it's custom query predicates early
			require("lazy.core.loader").add_to_rtp(plugin)
			require("nvim-treesitter.query_predicates")
		end,
		cmd = { "TSUpdateSync", "TSUpdate", "TSInstall" },
		keys = {
			{ "<c-space>", desc = "Increment Selection" },
			{ "<bs>", desc = "Decrement Selection", mode = "x" },
		},
		---@type TSConfig
		---@diagnostic disable-next-line: missing-fields
		opts = {
			highlight = { enable = true },
			indent = { enable = true },
			fold = {
				enable = true,
				additional_vim_regex_highlighting = false,
			},
			ensure_installed = {
				"bash",
				"c",
				"diff",
				"embedded_template",
				"erb",
				"go",
				"html",
				"javascript",
				"jsdoc",
				"json",
				"jsonc",
				"lua",
				"luadoc",
				"luap",
				"markdown",
				"markdown_inline",
				"printf",
				"python",
				"query",
				"ruby",
				"regex",
				"toml",
				"tsx",
				"typescript",
				"vim",
				"vimdoc",
				"yaml",
			},
			incremental_selection = {
				enable = true,
				keymaps = {
					init_selection = "<C-space>",
					node_incremental = "<C-space>",
					scope_incremental = false,
					node_decremental = "<bs>",
				},
			},
			textobjects = {
				move = {
					enable = true,
					goto_next_start = {
						["]f"] = "@function.outer",
						["]c"] = "@class.outer",
						["]a"] = "@parameter.inner",
					},
					goto_next_end = { ["]F"] = "@function.outer", ["]C"] = "@class.outer", ["]A"] = "@parameter.inner" },
					goto_previous_start = {
						["[f"] = "@function.outer",
						["[c"] = "@class.outer",
						["[a"] = "@parameter.inner",
					},
					goto_previous_end = {
						["[F"] = "@function.outer",
						["[C"] = "@class.outer",
						["[A"] = "@parameter.inner",
					},
				},
			},
		},
		---@param opts TSConfig
		config = function(_, opts)
			if type(opts.ensure_installed) == "table" then
				-- Remove duplicates from ensure_installed
				local seen = {}
				local result = {}
				for _, v in ipairs(opts.ensure_installed) do
					if not seen[v] then
						seen[v] = true
						table.insert(result, v)
					end
				end
				opts.ensure_installed = result
			end
			require("nvim-treesitter.configs").setup(opts)
		end,
	},

	{
		"nvim-treesitter/nvim-treesitter-textobjects",
		event = "BufReadPost",
		enabled = true,
		config = function()
			-- If treesitter is already loaded, we need to run config again for textobjects
			if package.loaded["nvim-treesitter"] then
				local opts = require("nvim-treesitter.configs").get_module("textobjects")
				require("nvim-treesitter.configs").setup({ textobjects = opts })
			end

			-- When in diff mode, we want to use the default
			-- vim text objects c & C instead of the treesitter ones.
			local move = require("nvim-treesitter.textobjects.move") ---@type table<string,fun(...)>
			local configs = require("nvim-treesitter.configs")
			for name, fn in pairs(move) do
				if name:find("goto") == 1 then
					move[name] = function(q, ...)
						if vim.wo.diff then
							local config = configs.get_module("textobjects.move")[name] ---@type table<string,string>
							for key, query in pairs(config or {}) do
								if q == query and key:find("[%]%[][cC]") then
									vim.cmd("normal! " .. key)
									return
								end
							end
						end
						return fn(q, ...)
					end
				end
			end
		end,
	},

	-- Automatically add closing tags for HTML and JSX
	{
		"windwp/nvim-ts-autotag",
		event = "BufReadPost",
		opts = {},
	},

	-- ERB folding configuration
	{
		"nvim-treesitter/nvim-treesitter",
		ft = "eruby",
		config = function()
			-- ERB-specific folding configuration
			vim.opt_local.foldmethod = "expr"
			vim.opt_local.foldexpr = "nvim_treesitter#foldexpr()"
			vim.opt_local.foldenable = true
			vim.opt_local.foldlevel = 99
			vim.opt_local.foldlevelstart = 99
			vim.opt_local.foldcolumn = "1"
			vim.opt_local.foldtext = "v:lua.vim.treesitter.foldtext()"
		end,
	},
}
