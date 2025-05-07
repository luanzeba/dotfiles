return {
	{
		"github/copilot.vim",
		lazy = false,
		config = function()
			vim.cmd([[
        imap <silent><script><expr> <C-J> copilot#Accept("\<CR>")
        let g:copilot_no_tab_map = v:true
      ]])
		end,
	},

	{
		"olimorris/codecompanion.nvim",
		opts = {
			strategies = {
				chat = {
					adapter = "copilot",
				},
				inline = {
					adapter = "copilot",
				},
				cmd = {
					adapter = "copilot",
				},
			},
			dependencies = {
				"nvim-lua/plenary.nvim",
				"nvim-treesitter/nvim-treesitter",
				"ravitemer/mcphub.nvim",
			},
		},
	},
}
