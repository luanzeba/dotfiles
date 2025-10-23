return {
	{
		"airblade/vim-gitgutter", -- Helpful git change navigation
		keys = {
			{ "]h", "<Plug>(GitGutterNextHunk)", desc = "Go to next hunk" },
			{ "[h", "<Plug>(GitGutterPrevHunk)", desc = "Go to previous hunk" },
			{ "<leader>ghs", "<Plug>(GitGutterStageHunk)", desc = "Stage hunk" },
			{ "<leader>ghu", "<Plug>(GitGutterUndoHunk)", desc = "Undo hunk" },
			{ "<leader>ghp", "<Plug>(GitGutterPreviewHunk)", desc = "Preview hunk" },
		},
	},

	{
		"tpope/vim-fugitive", -- The premier Vim plugin for Git
		lazy = false,
		keys = {
			{ "<leader>gg", "<cmd>Git<CR>5j", desc = "Git status" },
			{ "<leader>gr", "<cmd>Gread<CR>", desc = "Read file from git" },
			{ "<leader>gd", "<cmd>Gvdiffsplit<CR>", desc = "Vertical diff split" },
			{ "<leader>gD", "<cmd>Gdiffsplit<CR>", desc = "Horizontal diff split" },
		},
	},
}
