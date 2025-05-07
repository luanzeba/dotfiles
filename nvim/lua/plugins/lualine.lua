return {
	-- statusline
	{
		"nvim-lualine/lualine.nvim",
		event = "BufReadPost",
		init = function()
			vim.g.lualine_laststatus = vim.o.laststatus
			if vim.fn.argc(-1) > 0 then
				-- set an empty statusline till lualine loads
				vim.o.statusline = " "
			else
				-- hide the statusline on the starter page
				vim.o.laststatus = 0
			end
		end,
		opts = function()
			local icons = {
				diagnostics = {
					Error = "E",
					Warn = "W",
					Info = "I",
					Hint = "H",
				},
			}

			vim.o.laststatus = vim.g.lualine_laststatus

			local function get_root_dir()
				local path = vim.fn.getcwd()
				local home = os.getenv("HOME")
				if path:sub(1, #home) == home then
					path = "~" .. path:sub(#home + 1)
				end
				return path
			end

			local function get_pretty_path()
				local path = vim.fn.expand("%:p:~")
				local home = os.getenv("HOME")
				if path:sub(1, #home) == home then
					path = "~" .. path:sub(#home + 1)
				end
				return path
			end

			local opts = {
				options = {
					theme = "auto",
					globalstatus = vim.o.laststatus == 3,
					disabled_filetypes = { statusline = { "dashboard", "alpha" } },
				},
				sections = {
					lualine_a = { "mode" },
					lualine_b = { "branch" },
					lualine_c = {
						get_root_dir,
						{
							"diagnostics",
							symbols = {
								error = icons.diagnostics.Error,
								warn = icons.diagnostics.Warn,
								info = icons.diagnostics.Info,
								hint = icons.diagnostics.Hint,
							},
						},
						{ "filetype", icon_only = true, separator = "", padding = { left = 1, right = 0 } },
						get_pretty_path,
					},
					lualine_x = {},
					lualine_y = {
						{ "progress", separator = " ", padding = { left = 1, right = 0 } },
						{ "location", padding = { left = 0, right = 1 } },
					},
					lualine_z = {
						function()
							return " " .. os.date("%R")
						end,
					},
				},
				extensions = { "neo-tree", "lazy" },
			}

			return opts
		end,
	},
}
