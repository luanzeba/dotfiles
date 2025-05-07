return {
	-- icons
	{
		"echasnovski/mini.icons",
		lazy = true,
		opts = {
			file = {
				[".keep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
				["devcontainer.json"] = { glyph = "", hl = "MiniIconsAzure" },
			},
			filetype = {
				dotenv = { glyph = " ", hl = "MiniIconsYellow" },
			},
		},
		init = function()
			package.preload["nvim-web-devicons"] = function()
				require("mini.icons").mock_nvim_web_devicons()
				return package.loaded["nvim-web-devicons"]
			end
		end,
	},

	-- ui components
	{ "MunifTanjim/nui.nvim", lazy = true },

	-- dashboard
	{
		"nvimdev/dashboard-nvim",
		lazy = false,
		priority = 998,
		dependencies = {
			{ "nvim-tree/nvim-web-devicons" },
		},
		opts = function()
			local logo = [[


            ██╗      ██╗   ██╗ █████╗ ███╗   ██╗███████╗███████╗██████╗  █████╗
            ██║      ██║   ██║██╔══██╗████╗  ██║╚══███╔╝██╔════╝██╔══██╗██╔══██╗
            ██║      ██║   ██║███████║██╔██╗ ██║  ███╔╝ █████╗  ██████╔╝███████║
            ██║      ██║   ██║██╔══██║██║╚██╗██║ ███╔╝  ██╔══╝  ██╔══██╗██╔══██║
            ███████╗ ╚██████╔╝██║  ██║██║ ╚████║███████╗███████╗██████╔╝██║  ██║
            ╚══════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚═════╝ ╚═╝  ╚═╝
        ]]

			local opts = {
				theme = "doom",
				config = {
					header = vim.split(logo, "\n"),
					center = {
						{
							icon = " ",
							icon_hl = "Title",
							desc = "Find File",
							desc_hl = "String",
							key = "f",
							key_hl = "Number",
							action = "Telescope find_files",
						},
						{
							icon = " ",
							icon_hl = "Title",
							desc = "New File",
							desc_hl = "String",
							key = "n",
							key_hl = "Number",
							action = "enew",
						},
						{
							icon = " ",
							icon_hl = "Title",
							desc = "Find Text",
							desc_hl = "String",
							key = "g",
							key_hl = "Number",
							action = "Telescope live_grep",
						},
						{
							icon = " ",
							icon_hl = "Title",
							desc = "Recent Files",
							desc_hl = "String",
							key = "r",
							key_hl = "Number",
							action = "Telescope oldfiles",
						},
						{
							icon = " ",
							icon_hl = "Title",
							desc = "Config",
							desc_hl = "String",
							key = "c",
							key_hl = "Number",
							action = "Telescope find_files cwd=" .. vim.fn.stdpath("config"),
						},
						{
							icon = " ",
							icon_hl = "Title",
							desc = "Quit",
							desc_hl = "String",
							key = "q",
							key_hl = "Number",
							action = "qa",
						},
					},
					footer = {},
				},
			}
			return opts
		end,
	},
}
