return {
	-- lush.nvim: required for jellybeans-nvim
	{
		"rktjmp/lush.nvim",
		lazy = false,
		priority = 1000,
	},

	-- jellybeans theme
	{
		"metalelf0/jellybeans-nvim",
		lazy = false,
		priority = 999,
		config = function()
			vim.cmd.colorscheme("jellybeans-nvim")
		end,
	},
}
