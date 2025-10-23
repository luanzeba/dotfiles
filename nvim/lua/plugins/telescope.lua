return {
	"nvim-telescope/telescope.nvim",
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
		{ "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
		"nvim-telescope/telescope-live-grep-args.nvim",
	},
	cmd = "Telescope",
	keys = {
		{ "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Find Files" },
		{ "<leader>fg", "<cmd>Telescope live_grep_args<cr>", desc = "Live Grep with Args" },
		{ "<leader>fb", "<cmd>Telescope buffers<cr>", desc = "Buffers" },
		{ "<leader>fh", "<cmd>Telescope help_tags<cr>", desc = "Help Tags" },
		{ "<leader>fwd", function()
			local dir = vim.fn.input("Directory: ", vim.fn.expand("%:p:h"), "dir")
			if dir ~= "" then
				require('telescope.builtin').live_grep({ search_dirs = { dir } })
			end
		end, desc = "Live grep in directory" },
	},
	opts = {
		defaults = {
			vimgrep_arguments = {
				"rg",
				"-L",
				"--color=never",
				"--no-heading",
				"--with-filename",
				"--line-number",
				"--column",
				"--smart-case",
			},
			prompt_prefix = "🔍️ ",
			selection_caret = "  ",
			entry_prefix = "  ",
			initial_mode = "insert",
			selection_strategy = "reset",
			sorting_strategy = "ascending",
			layout_strategy = "horizontal",
			layout_config = {
				horizontal = {
					prompt_position = "top",
					preview_width = 0.55,
					results_width = 0.8,
				},
				vertical = {
					mirror = false,
				},
				width = 0.87,
				height = 0.80,
				preview_cutoff = 120,
			},
			path_display = { "truncate" },
			winblend = 0,
			border = {},
			borderchars = { "─", "│", "─", "│", "╭", "╮", "╯", "╰" },
			color_devicons = true,
			set_env = { ["COLORTERM"] = "truecolor" },
			file_ignore_patterns = { "node_modules" },
			mappings = {
				n = {
					["q"] = "close",
				},
				i = {
					["<esc>"] = "close",
					["<C-h>"] = "which_key",
				},
			},
		},
		extensions = {
			fzf = {
				fuzzy = true,
				override_generic_sorter = true,
				override_file_sorter = true,
				case_mode = "smart_case",
			},
		},
	},
	config = function(_, opts)
		local telescope = require("telescope")
		local actions = require("telescope.actions")

		-- Add custom action to open all selected files
		local select_one_or_multi = function(prompt_bufnr)
			local picker = require('telescope.actions.state').get_current_picker(prompt_bufnr)
			local multi = picker:get_multi_selection()
			if not vim.tbl_isempty(multi) then
				actions.close(prompt_bufnr)
				for _, j in pairs(multi) do
					if j.path ~= nil then
						vim.cmd(string.format("%s %s", "edit", j.path))
					end
				end
			else
				actions.select_default(prompt_bufnr)
			end
		end

		-- Override the default select action
		opts.defaults.mappings.i["<CR>"] = select_one_or_multi
		opts.defaults.mappings.n["<CR>"] = select_one_or_multi

		-- Add quickfix mappings
		opts.defaults.mappings.i["<C-q>"] = actions.smart_send_to_qflist + actions.open_qflist
		opts.defaults.mappings.n["<C-q>"] = actions.smart_send_to_qflist + actions.open_qflist
		opts.defaults.mappings.i["<M-q>"] = actions.send_to_qflist + actions.open_qflist
		opts.defaults.mappings.n["<M-q>"] = actions.send_to_qflist + actions.open_qflist

		telescope.setup(opts)

		-- Load extensions
		pcall(function()
			telescope.load_extension("fzf")
			telescope.load_extension("live_grep_args")
		end)
	end,
}
