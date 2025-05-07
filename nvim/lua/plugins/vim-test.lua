return {
	{
		"vim-test/vim-test", -- A Vim wrapper for running tests on different granularities.
		keys = {
			{ "<leader>tt", "<cmd>TestFile<CR>", desc = "Run all tests in file" },
			{ "<leader>tn", "<cmd>TestNearest<CR>", desc = "Run nearest test" },
			{ "<leader>ts", "<cmd>TestSuite<CR>", desc = "Run all tests in suite" },
			{ "<leader>tl", "<cmd>TestLast<CR>", desc = "Run last test" },
			{ "<leader>tf", "<cmd>TestVisit<CR>", desc = "Visit test file" },
		},
		dependencies = {
			"preservim/vimux", -- Easily interact with tmux from vim
		},
		config = function()
			vim.cmd([[let test#strategy = "vimux"]])
		end,
	},
}
