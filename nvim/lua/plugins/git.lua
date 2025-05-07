return {
	{
		"airblade/vim-gitgutter", -- Helpful git change navigation
		keys = {
			{ "]h", "<Plug>(GitGutterNextHunk)", desc = "Go to next hunk" },
			{ "[h", "<Plug>(GitGutterPrevHunk)", desc = "Go to previous hunk" },
		},
	},

	{
		"tpope/vim-fugitive", -- The premier Vim plugin for Git
		lazy = false,
		keys = {
			{ "<leader>gg", "<cmd>Git<CR>5j", desc = "Git status" },
			{ "<leader>gr", "<cmd>Gread<CR>", desc = "Read file from git" },
		},
	},
}
